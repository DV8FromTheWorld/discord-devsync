import {
  existsSync,
  statSync,
  mkdirSync,
  readdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { resolve, relative } from 'path';
import { REMOTES_DIR, DATA_DIR } from '../config.js';
import { debug, warn, error } from '../log.js';
import {
  filesAreIdentical,
  dirsAreIdentical,
  generateFileDiffs,
  generateDirDiffs,
} from './content-compare.js';
import { type DiffSet } from './content-compare.js';
import { rsyncMirror } from '../ssh.js';
import {
  type ContentChange,
  type FileChange,
  type MergeConflict,
  computeDiffStats,
  formatDiffBar,
  snapshotTextFiles,
  directoryDiffBar,
  loadConflicts,
  saveConflicts,
  addConflict,
  removeConflict,
} from './changes.js';

const execFileAsync = promisify(execFile);

// ─── Strategy interfaces ───────────────────────────────────────

export interface MergeOps {
  /** Get the mtime to compare against remotes. For dirs, returns the newest file mtime. */
  mtime(path: string): number;
  /** Check whether all remote paths have identical content. */
  areIdentical(paths: string[]): boolean;
  /** Copy a single remote to the merged location. */
  copy(src: string, dst: string): Promise<void>;
  /** Generate diffs for the Claude prompt. */
  generateDiffs(mergedPath: string | null, remotes: string[], remotesDir: string): DiffSet;
  /** Snapshot old state before merge. Returns opaque state for later comparison. */
  snapshot(mergedPath: string): unknown;
  /** Check whether content actually changed after merge. */
  unchanged(oldSnapshot: unknown, mergedPath: string): boolean;
  /** Compute diff bar after merge. Returns undefined if no meaningful change. */
  diffBar(oldSnapshot: unknown, mergedPath: string): string | undefined;
  /** Ensure parent/target directory exists for the merged path. */
  ensureDir(mergedPath: string): void;
}

export const fileMergeOps: MergeOps = {
  mtime: (path) => statSync(path).mtimeMs,
  areIdentical: filesAreIdentical,
  copy: async (src, dst) => {
    copyFileSync(src, dst);
  },
  generateDiffs: generateFileDiffs,
  snapshot: (path) => (existsSync(path) ? readFileSync(path, 'utf-8') : null),
  unchanged: (old, path) => {
    if (typeof old !== 'string') return false;
    try {
      return readFileSync(path, 'utf-8') === old;
    } catch {
      return false;
    }
  },
  diffBar: (old, path) => {
    if (typeof old !== 'string') return undefined;
    try {
      const newContent = readFileSync(path, 'utf-8');
      const stats = computeDiffStats(old, newContent);
      if (stats.added > 0 || stats.removed > 0) return formatDiffBar(stats.added, stats.removed);
    } catch {
      /* skip */
    }
    return undefined;
  },
  ensureDir: (path) => mkdirSync(resolve(path, '..'), { recursive: true }),
};

function newestMtime(dir: string): number {
  let newest = 0;
  function walk(current: string): void {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const mtime = statSync(full).mtimeMs;
        if (mtime > newest) newest = mtime;
      }
    }
  }
  walk(dir);
  return newest;
}

export const dirMergeOps: MergeOps = {
  mtime: newestMtime,
  areIdentical: dirsAreIdentical,
  copy: async (src, dst) => {
    await rsyncMirror(src + '/', dst + '/');
  },
  generateDiffs: generateDirDiffs,
  snapshot: (path) => (existsSync(path) ? snapshotTextFiles(path) : new Map<string, string>()),
  unchanged: (old, path) => {
    const oldMap = old as Map<string, string>;
    const newMap = snapshotTextFiles(path);
    if (oldMap.size !== newMap.size) return false;
    for (const [k, v] of oldMap) {
      if (newMap.get(k) !== v) return false;
    }
    return true;
  },
  diffBar: (old, path) => directoryDiffBar(old as Map<string, string>, path),
  ensureDir: (path) => mkdirSync(path, { recursive: true }),
};

// ─── Per-item and per-module config ────────────────────────────

export interface MergeItem {
  /** Display name for this item. */
  name: string;
  /** Absolute path to the merged output. */
  mergedPath: string;
  /** Absolute paths to all remote versions that exist. */
  remotePaths: string[];
  /** Key for conflict tracking (e.g. "kb:file.md"). Null disables conflict tracking. */
  conflictKey: string | null;
}

export interface MergeConfig {
  /** Label for the returned ContentChange. */
  label: string;
  /** File vs directory operations. */
  ops: MergeOps;
  /** Build the Claude prompt for a conflicted merge. */
  buildPrompt(item: MergeItem, diffs: DiffSet): string;
  /** Claude CLI allowed tools string. */
  allowedTools: string;
  /** What to do when Claude merge fails. */
  onClaudeFail: 'exit' | 'conflict';
  /** Suffix to append to item name in FileChange (e.g. "/" for directories). */
  nameSuffix?: string;
}

// ─── Claude CLI invocation ─────────────────────────────────────

async function invokeClaudeMerge(prompt: string, allowedTools: string): Promise<boolean> {
  try {
    await execFileAsync(
      'claude',
      [
        '--allowedTools',
        allowedTools,
        '--permission-mode',
        'dontAsk',
        '--model',
        'sonnet',
        '-p',
        prompt,
      ],
      {
        cwd: DATA_DIR,
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      },
    );
    return true;
  } catch {
    return false;
  }
}

// ─── Core engine ───────────────────────────────────────────────

export async function mergeItems(
  items: MergeItem[],
  config: MergeConfig,
): Promise<ContentChange | null> {
  const { label, ops, buildPrompt, allowedTools, onClaudeFail, nameSuffix } = config;
  const useConflicts = items.some((i) => i.conflictKey !== null);
  const conflicts = useConflicts ? loadConflicts() : [];
  const files: FileChange[] = [];

  for (const item of items) {
    const { name, mergedPath, remotePaths, conflictKey } = item;
    const existed = existsSync(mergedPath);
    const mergedMtime = existed ? ops.mtime(mergedPath) : 0;

    // Filter to remotes newer than merged
    const newerRemotes = remotePaths.filter((r) => {
      try {
        return ops.mtime(r) > mergedMtime;
      } catch {
        return false;
      }
    });

    if (newerRemotes.length === 0) continue;

    const oldSnapshot = existed ? ops.snapshot(mergedPath) : null;
    let claudeMerge = false;

    ops.ensureDir(mergedPath);

    if (newerRemotes.length === 1) {
      const host = relative(REMOTES_DIR, newerRemotes[0]).split('/')[0];
      debug(`  ${name}: updated by ${host} — copying`);
      await ops.copy(newerRemotes[0], mergedPath);
      if (conflictKey) removeConflict(conflicts, conflictKey);
    } else if (ops.areIdentical(newerRemotes)) {
      debug(`  ${name}: ${newerRemotes.length} hosts updated, content identical — copying`);
      await ops.copy(newerRemotes[0], mergedPath);
      if (conflictKey) removeConflict(conflicts, conflictKey);
    } else {
      // Multi-way conflict — invoke Claude
      const diffs = ops.generateDiffs(existed ? mergedPath : null, newerRemotes, REMOTES_DIR);
      const prompt = buildPrompt(item, diffs);

      debug(`  Invoking Claude to merge ${name}...`);
      const success = await invokeClaudeMerge(prompt, allowedTools);

      if (!success) {
        if (onClaudeFail === 'exit') {
          error(`${label} merge failed for ${name}`);
          process.exit(1);
        }
        // Soft failure — record conflict, don't overwrite merged/
        const hostNames = newerRemotes.map((r) => relative(REMOTES_DIR, r).split('/')[0]);
        if (conflictKey) {
          addConflict(conflicts, {
            key: conflictKey,
            hosts: hostNames,
            reason: 'Claude merge failed',
            timestamp: new Date().toISOString(),
          });
        }
        warn(`  Claude merge failed for ${name}`);
        files.push({
          name: nameSuffix ? name + nameSuffix : name,
          type: '~',
          conflict: true,
          note: `Versions differ on: ${hostNames.join(', ')}. Resolve in merged/ or re-run sync to retry.`,
        });
        continue;
      }

      claudeMerge = true;
      if (conflictKey) removeConflict(conflicts, conflictKey);
      debug(`  Merged ${name} from ${newerRemotes.length} sources`);
    }

    // Check if content actually changed
    if (existed && oldSnapshot !== null && ops.unchanged(oldSnapshot, mergedPath)) continue;

    const fc: FileChange = {
      name: nameSuffix ? name + nameSuffix : name,
      type: existed ? '~' : '+',
    };

    if (existed && oldSnapshot !== null) {
      fc.diffBar = ops.diffBar(oldSnapshot, mergedPath);
    }

    if (claudeMerge) {
      fc.note = 'conflict resolved via Claude';
    }

    files.push(fc);
  }

  if (useConflicts) saveConflicts(conflicts);
  if (files.length === 0) return null;
  return { label, files };
}
