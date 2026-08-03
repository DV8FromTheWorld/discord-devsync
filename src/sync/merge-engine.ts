import { spawn } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs';
import { relative, resolve } from 'path';

import { DATA_DIR, REMOTES_DIR } from '../config.js';
import { debug, getLogFilePath, logDetail, warn } from '../log.js';
import { rsyncMirror } from '../ssh.js';
import { hasText } from '../text.js';
import {
  addConflict,
  computeDiffStats,
  type ContentChange,
  directoryDiffBar,
  type FileChange,
  formatDiffBar,
  loadConflicts,
  removeConflict,
  saveConflicts,
  snapshotTextFiles,
} from './changes.js';
import {
  dirsAreIdentical,
  filesAreIdentical,
  generateDirDiffs,
  generateFileDiffs,
} from './content-compare.js';
import { type DiffSet } from './content-compare.js';

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
    if (typeof old !== 'string') {
      return false;
    }
    try {
      return readFileSync(path, 'utf-8') === old;
    } catch {
      return false;
    }
  },
  diffBar: (old, path) => {
    if (typeof old !== 'string') {
      return undefined;
    }
    try {
      const newContent = readFileSync(path, 'utf-8');
      const stats = computeDiffStats(old, newContent);
      if (stats.added > 0 || stats.removed > 0) {
        return formatDiffBar(stats.added, stats.removed);
      }
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
    if (!existsSync(current)) {
      return;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const mtime = statSync(full).mtimeMs;
        if (mtime > newest) {
          newest = mtime;
        }
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
    if (oldMap.size !== newMap.size) {
      return false;
    }
    for (const [k, v] of oldMap) {
      if (newMap.get(k) !== v) {
        return false;
      }
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
  /** Suffix to append to item name in FileChange (e.g. "/" for directories). */
  nameSuffix?: string;
}

// ─── Claude CLI invocation ─────────────────────────────────────

/**
 * Run the Claude CLI to merge one item.
 *
 * Uses spawn rather than execFile so stdin can be closed: handed an open pipe it will
 * never receive data on, the CLI stalls ~3s per invocation waiting for input. execFile's
 * stdio option does not cover stdin, so it cannot express that.
 *
 * The prompt and all output land in the log file — a merge that fails is the one case
 * where knowing what Claude actually said matters, and it used to be discarded.
 */
function invokeClaudeMerge(name: string, prompt: string, allowedTools: string): Promise<boolean> {
  logDetail(`claude prompt: ${name}`, prompt);

  return new Promise((resolvePromise) => {
    const child = spawn(
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
      { cwd: DATA_DIR, stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf-8');
    child.stderr.setEncoding('utf-8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));

    child.on('error', (err) => {
      logDetail(`claude merge FAILED to launch: ${name}`, String(err));
      resolvePromise(false);
    });

    child.on('close', (code, signal) => {
      if (stdout !== '') {
        logDetail(`claude stdout: ${name}`, stdout);
      }
      if (stderr !== '') {
        logDetail(`claude stderr: ${name}`, stderr);
      }
      if (code === 0) {
        resolvePromise(true);
        return;
      }
      logDetail(
        `claude merge FAILED: ${name}`,
        `exit code: ${code}\nsignal: ${signal ?? '(none)'}`
      );
      resolvePromise(false);
    });
  });
}

/** Host directory name that a remote path sits under. */
function hostNameOf(remotePath: string): string {
  const [host] = relative(REMOTES_DIR, remotePath).split('/');
  return host ?? '';
}

// ─── Core engine ───────────────────────────────────────────────

export async function mergeItems(
  items: MergeItem[],
  config: MergeConfig
): Promise<ContentChange | null> {
  const { label, ops, allowedTools, nameSuffix } = config;
  const useConflicts = items.some((i) => i.conflictKey !== null);
  const conflicts = useConflicts ? loadConflicts() : [];
  const files: FileChange[] = [];

  const displayName = (name: string): string => (hasText(nameSuffix) ? name + nameSuffix : name);

  /**
   * Merge a single item, returning the change to report or null when there was nothing to
   * do. Anything genuinely unexpected throws, and the caller turns it into a conflict —
   * see the loop below.
   */
  async function mergeOne(item: MergeItem): Promise<FileChange | null> {
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

    if (newerRemotes.length === 0) {
      return null;
    }

    // A newer mtime does not mean different content. rsync preserves times, so a re-fetch
    // or a little clock skew can leave a byte-identical file looking newer than merged —
    // and one of those alongside a genuinely edited host reads as a two-way conflict,
    // forcing a Claude merge for what is really a straight copy. Compare content first.
    const changedRemotes = existed
      ? newerRemotes.filter((remote) => {
          try {
            return !ops.areIdentical([remote, mergedPath]);
          } catch {
            return true; // unreadable — let the merge path deal with it
          }
        })
      : newerRemotes;

    if (changedRemotes.length === 0) {
      debug(`  ${name}: ${newerRemotes.length} remote(s) newer but content identical — skipping`);
      return null;
    }

    const oldSnapshot = existed ? ops.snapshot(mergedPath) : null;
    let claudeMerge = false;

    ops.ensureDir(mergedPath);

    const firstChangedRemote = changedRemotes[0];
    if (firstChangedRemote === undefined) {
      return null;
    }

    if (changedRemotes.length === 1) {
      const host = hostNameOf(firstChangedRemote);
      debug(`  ${name}: updated by ${host} — copying`);
      await ops.copy(firstChangedRemote, mergedPath);
      if (conflictKey !== null) {
        removeConflict(conflicts, conflictKey);
      }
    } else if (ops.areIdentical(changedRemotes)) {
      debug(`  ${name}: ${changedRemotes.length} hosts updated, content identical — copying`);
      await ops.copy(firstChangedRemote, mergedPath);
      if (conflictKey !== null) {
        removeConflict(conflicts, conflictKey);
      }
    } else {
      // Multi-way conflict — invoke Claude
      const diffs = ops.generateDiffs(existed ? mergedPath : null, changedRemotes, REMOTES_DIR);
      const prompt = config.buildPrompt(item, diffs);

      debug(`  Invoking Claude to merge ${name}...`);
      const success = await invokeClaudeMerge(name, prompt, allowedTools);

      if (!success) {
        // Record the conflict and leave merged/ alone. Every layer behaves this way: no
        // single file may abort the sync, and push skips conflicted paths so the last
        // good version stays put until the next run retries.
        const hostNames = changedRemotes.map((r) => hostNameOf(r));
        if (conflictKey !== null) {
          addConflict(conflicts, {
            key: conflictKey,
            hosts: hostNames,
            reason: 'Claude merge failed',
            timestamp: new Date().toISOString(),
          });
        }
        warn(`  Claude merge failed for ${name}`);
        return {
          name: displayName(name),
          type: '~',
          conflict: true,
          note: `Versions differ on: ${hostNames.join(', ')}. Resolve in merged/ or re-run sync to retry.`,
        };
      }

      claudeMerge = true;
      if (conflictKey !== null) {
        removeConflict(conflicts, conflictKey);
      }
      debug(`  Merged ${name} from ${changedRemotes.length} sources`);
    }

    // Check if content actually changed
    if (existed && oldSnapshot !== null && ops.unchanged(oldSnapshot, mergedPath)) {
      return null;
    }

    const fc: FileChange = {
      name: displayName(name),
      type: existed ? '~' : '+',
    };

    if (existed && oldSnapshot !== null) {
      fc.diffBar = ops.diffBar(oldSnapshot, mergedPath);
    }

    if (claudeMerge) {
      fc.note = 'conflict resolved via Claude';
    }

    return fc;
  }

  for (const item of items) {
    try {
      const change = await mergeOne(item);
      if (change) {
        files.push(change);
      }
    } catch (err) {
      // An unreadable file, a failed copy, or a diff that blew up must not take the rest
      // of the merge down with it. Before this, a throw here escaped all the way out of
      // the sync — abandoning the remaining items and, because saveConflicts runs after
      // this loop, discarding the conflict bookkeeping for everything already merged
      // (including conflicts that had just been resolved).
      const message = err instanceof Error ? err.message : String(err);
      logDetail(
        `merge error: ${item.name}`,
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      );
      warn(`  ${label} merge failed for ${item.name}: ${message}`);
      const logPath = getLogFilePath();
      if (hasText(logPath)) {
        warn(`    details in ${logPath}`);
      }
      if (item.conflictKey !== null) {
        addConflict(conflicts, {
          key: item.conflictKey,
          hosts: item.remotePaths.map((r) => hostNameOf(r)),
          reason: `merge error: ${message}`,
          timestamp: new Date().toISOString(),
        });
      }
      files.push({
        name: displayName(item.name),
        type: '~',
        conflict: true,
        note: `Merge failed: ${message}. merged/ left unchanged; re-run sync to retry.`,
      });
    }
  }

  if (useConflicts) {
    saveConflicts(conflicts);
  }
  if (files.length === 0) {
    return null;
  }
  return { label, files };
}
