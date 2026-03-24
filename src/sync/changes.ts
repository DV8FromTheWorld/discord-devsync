import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve, relative } from 'path';
import ora from 'ora';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

// ─── Types ──────────────────────────────────────────────────────

export interface FileChange {
  name: string;
  type: '+' | '~';
  diffBar?: string; // pre-colored string like "+++--"
  note?: string; // e.g. "conflict resolved via Claude"
}

export interface ContentChange {
  label: string;
  files?: FileChange[];
  summary?: string; // for non-file changes, e.g. "+3 rules"
}

export interface HostChanges {
  host: string;
  unreachable: boolean;
  changes: ContentChange[];
  errors: string[];
}

// ─── Rsync output parsing ───────────────────────────────────────

export interface RsyncFileChange {
  path: string;
  type: '+' | '~';
}

/**
 * Parse rsync --itemize-changes output to determine which files are new vs modified.
 *
 * Format: YXcstpoguax path
 * Y = update type (> sent, < received)
 * X = file type (f = regular file, d = directory)
 * Positions 2-10 = change flags (+ for new, letter for changed, . for unchanged)
 */
export function parseRsyncItemize(stdout: string): RsyncFileChange[] {
  const changes: RsyncFileChange[] = [];
  for (const line of stdout.split('\n')) {
    if (line.length < 13) continue;

    const updateType = line[0];
    const fileType = line[1];

    // Only track regular files
    if (fileType !== 'f') continue;

    // Only track transferred files
    if (updateType !== '>' && updateType !== '<') continue;

    const flags = line.slice(2, 11);
    const path = line.slice(12);
    if (!path) continue;

    if (flags === '+++++++++') {
      changes.push({ path, type: '+' });
    } else {
      // Check checksum (pos 0) or size (pos 1) changed — skip timestamp-only changes
      const checksumChanged = flags[0] !== '.';
      const sizeChanged = flags[1] !== '.';
      if (checksumChanged || sizeChanged) {
        changes.push({ path, type: '~' });
      }
    }
  }
  return changes;
}

// ─── Diff computation ───────────────────────────────────────────

export function computeDiffStats(
  oldContent: string,
  newContent: string,
): { added: number; removed: number } {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Find common prefix
  let commonPrefix = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (commonPrefix < minLen && oldLines[commonPrefix] === newLines[commonPrefix]) {
    commonPrefix++;
  }

  // Find common suffix (from the remaining lines after prefix)
  let commonSuffix = 0;
  const maxSuffix = minLen - commonPrefix;
  while (
    commonSuffix < maxSuffix &&
    oldLines[oldLines.length - 1 - commonSuffix] === newLines[newLines.length - 1 - commonSuffix]
  ) {
    commonSuffix++;
  }

  return {
    added: Math.max(0, newLines.length - commonPrefix - commonSuffix),
    removed: Math.max(0, oldLines.length - commonPrefix - commonSuffix),
  };
}

export function formatDiffBar(added: number, removed: number): string {
  if (added === 0 && removed === 0) return '';

  const total = added + removed;
  const maxWidth = 10;
  const scaled = Math.min(total, maxWidth);

  let addChars: number;
  let removeChars: number;

  if (removed === 0) {
    addChars = scaled;
    removeChars = 0;
  } else if (added === 0) {
    addChars = 0;
    removeChars = scaled;
  } else {
    addChars = Math.max(1, Math.round((added / total) * scaled));
    removeChars = Math.max(1, scaled - addChars);
  }

  const parts: string[] = [];
  if (addChars > 0) parts.push(`${GREEN}${'+'.repeat(addChars)}${RESET}`);
  if (removeChars > 0) parts.push(`${RED}${'-'.repeat(removeChars)}${RESET}`);
  return parts.join('');
}

/** Compute a diff bar between two file paths. Returns undefined if files are identical or unreadable. */
export function diffBarForFiles(oldPath: string, newPath: string): string | undefined {
  try {
    const oldContent = readFileSync(oldPath, 'utf-8');
    const newContent = readFileSync(newPath, 'utf-8');
    if (oldContent === newContent) return undefined;
    const { added, removed } = computeDiffStats(oldContent, newContent);
    if (added === 0 && removed === 0) return undefined;
    return formatDiffBar(added, removed);
  } catch {
    return undefined;
  }
}

// ─── Snapshot utilities ─────────────────────────────────────────

/** Read all text files in a directory into a map keyed by relative path. */
export function snapshotTextFiles(dir: string, extensions = ['.md']): Map<string, string> {
  const snapshot = new Map<string, string>();
  if (!existsSync(dir)) return snapshot;

  function walk(current: string): void {
    try {
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = resolve(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
          try {
            snapshot.set(relative(dir, full), readFileSync(full, 'utf-8'));
          } catch {
            /* skip unreadable files */
          }
        }
      }
    } catch {
      /* skip unreadable directories */
    }
  }
  walk(dir);
  return snapshot;
}

// ─── Helpers for building changes from rsync output ─────────────

/** Build FileChange array from rsync itemize output, with diff bars from a pre-rsync snapshot. */
export function buildFileChanges(
  stdout: string,
  baseDir: string,
  snapshot: Map<string, string>,
): FileChange[] {
  const rsyncChanges = parseRsyncItemize(stdout);
  return rsyncChanges.map((rc) => {
    const fc: FileChange = { name: rc.path, type: rc.type };
    if (rc.type === '~') {
      const oldContent = snapshot.get(rc.path);
      if (oldContent) {
        try {
          const newContent = readFileSync(resolve(baseDir, rc.path), 'utf-8');
          const stats = computeDiffStats(oldContent, newContent);
          if (stats.added > 0 || stats.removed > 0) {
            fc.diffBar = formatDiffBar(stats.added, stats.removed);
          }
        } catch {
          /* skip unreadable */
        }
      }
    }
    return fc;
  });
}

/**
 * Aggregate file-level rsync changes to directory level (e.g. for skills).
 * If baseDir and snapshot are provided, computes aggregate diff bars for modified directories.
 */
export function aggregateToDirectories(
  changes: RsyncFileChange[],
  baseDir?: string,
  snapshot?: Map<string, string>,
): FileChange[] {
  const dirMap = new Map<string, { types: Set<'+' | '~'>; files: RsyncFileChange[] }>();
  for (const rc of changes) {
    const parts = rc.path.split('/');
    if (parts.length < 2) continue;
    const dirName = parts[0];
    if (!dirMap.has(dirName)) dirMap.set(dirName, { types: new Set(), files: [] });
    const entry = dirMap.get(dirName)!;
    entry.types.add(rc.type);
    entry.files.push(rc);
  }

  const result: FileChange[] = [];
  for (const [name, { types, files }] of dirMap) {
    const type = types.has('~') ? '~' : '+';
    let diffBar: string | undefined;

    if (baseDir && snapshot && type === '~') {
      let totalAdded = 0;
      let totalRemoved = 0;
      for (const rc of files) {
        if (rc.type === '~') {
          const oldContent = snapshot.get(rc.path);
          if (oldContent) {
            try {
              const newContent = readFileSync(resolve(baseDir, rc.path), 'utf-8');
              const stats = computeDiffStats(oldContent, newContent);
              totalAdded += stats.added;
              totalRemoved += stats.removed;
            } catch {
              /* skip */
            }
          }
        } else {
          // New file within modified directory — count as additions
          try {
            const newContent = readFileSync(resolve(baseDir, rc.path), 'utf-8');
            totalAdded += newContent.split('\n').length;
          } catch {
            /* skip */
          }
        }
      }
      if (totalAdded > 0 || totalRemoved > 0) {
        diffBar = formatDiffBar(totalAdded, totalRemoved);
      }
    }

    result.push({ name: name + '/', type, diffBar });
  }
  return result;
}

/** Compute aggregate diff bar for a directory by comparing old snapshot against current state. */
export function directoryDiffBar(
  oldSnapshot: Map<string, string>,
  dir: string,
): string | undefined {
  const newSnapshot = snapshotTextFiles(dir);
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const [path, newContent] of newSnapshot) {
    const oldContent = oldSnapshot.get(path);
    if (!oldContent) {
      totalAdded += newContent.split('\n').length;
    } else if (oldContent !== newContent) {
      const stats = computeDiffStats(oldContent, newContent);
      totalAdded += stats.added;
      totalRemoved += stats.removed;
    }
  }

  for (const [path, oldContent] of oldSnapshot) {
    if (!newSnapshot.has(path)) {
      totalRemoved += oldContent.split('\n').length;
    }
  }

  if (totalAdded === 0 && totalRemoved === 0) return undefined;
  return formatDiffBar(totalAdded, totalRemoved);
}

// ─── Rendering ──────────────────────────────────────────────────

const MAX_FILES_SHOWN = 3;

function printFileChange(file: FileChange, indent: string): void {
  const marker = file.type === '+' ? `${GREEN}+${RESET}` : `${YELLOW}~${RESET}`;
  const bar = file.diffBar ? `  ${file.diffBar}` : '';
  const note = file.note ? `  ${DIM}(${file.note})${RESET}` : '';
  console.log(`${indent}${marker} ${file.name}${bar}${note}`);
}

function printContentChange(change: ContentChange, indent: string): void {
  if (change.summary) {
    console.log(`${indent}${change.label} — ${change.summary}`);
    return;
  }

  if (!change.files || change.files.length === 0) return;

  // Single file matching label — render as one line without header
  if (change.files.length === 1 && change.files[0].name === change.label) {
    printFileChange(change.files[0], indent);
    return;
  }

  console.log(`${indent}${change.label}`);
  const fileIndent = indent + '  ';

  const shown = change.files.slice(0, MAX_FILES_SHOWN);
  const remaining = change.files.length - shown.length;

  for (const file of shown) {
    printFileChange(file, fileIndent);
  }

  if (remaining > 0) {
    console.log(`${fileIndent}${DIM}... and ${remaining} more${RESET}`);
  }
}

export function printHostChanges(result: HostChanges): void {
  if (result.unreachable) {
    ora({ prefixText: '  ' }).fail(`${result.host} — unreachable`);
    return;
  }

  if (result.changes.length === 0 && result.errors.length === 0) {
    ora({ prefixText: '  ' }).succeed(`${result.host} — ${DIM}no changes${RESET}`);
    return;
  }

  if (result.errors.length > 0 && result.changes.length === 0) {
    ora({ prefixText: '  ' }).fail(result.host);
    for (const err of result.errors) {
      console.log(`      ${RED}✖${RESET} ${err}`);
    }
    return;
  }

  ora({ prefixText: '  ' }).succeed(result.host);
  for (const change of result.changes) {
    printContentChange(change, '      ');
  }
  for (const err of result.errors) {
    console.log(`      ${RED}✖${RESET} ${err}`);
  }
}

export function printMergeChanges(changes: ContentChange[]): void {
  for (const change of changes) {
    if ((change.files && change.files.length > 0) || change.summary) {
      printContentChange(change, '  ');
    } else {
      console.log(`  ${change.label} — ${DIM}identical, skipped${RESET}`);
    }
  }
}
