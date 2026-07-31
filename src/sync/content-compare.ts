import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';

import { hasText } from '../text.js';

/** True if all files have byte-identical content */
export function filesAreIdentical(paths: string[]): boolean {
  if (paths.length < 2) {
    return true;
  }
  const [firstPath, ...otherPaths] = paths;
  if (firstPath === undefined) {
    return true;
  }
  const first = readFileSync(firstPath, 'utf-8');
  for (const path of otherPaths) {
    if (readFileSync(path, 'utf-8') !== first) {
      return false;
    }
  }
  return true;
}

/** Collect sorted relative paths for all files in a directory, skipping .DS_Store */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  function walk(current: string): void {
    if (!existsSync(current)) {
      return;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') {
        continue;
      }
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        results.push(relative(dir, full));
      }
    }
  }
  walk(dir);
  return results.sort();
}

/** True if all directories have identical structure + file contents */
export function dirsAreIdentical(paths: string[]): boolean {
  if (paths.length < 2) {
    return true;
  }

  const [firstDir, ...otherDirs] = paths;
  if (firstDir === undefined) {
    return true;
  }

  const firstFiles = collectFiles(firstDir);
  for (const dir of otherDirs) {
    const otherFiles = collectFiles(dir);
    if (firstFiles.length !== otherFiles.length) {
      return false;
    }
    for (let j = 0; j < firstFiles.length; j++) {
      if (firstFiles[j] !== otherFiles[j]) {
        return false;
      }
    }
    // Same structure — compare file contents
    for (const rel of firstFiles) {
      const a = readFileSync(resolve(firstDir, rel), 'utf-8');
      const b = readFileSync(resolve(dir, rel), 'utf-8');
      if (a !== b) {
        return false;
      }
    }
  }
  return true;
}

export interface DiffSet {
  basePath: string;
  baseLabel: string;
  diffs: Array<{
    host: string;
    diff: string;
  }>;
}

function runDiff(fileA: string, fileB: string): string {
  try {
    execFileSync('diff', ['-u', fileA, fileB], { encoding: 'utf-8' });
    return ''; // identical
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1 && typeof e.stdout === 'string') {
      return e.stdout; // files differ — normal exit code 1
    }
    throw err; // real error
  }
}

function hostFromPath(remotePath: string, remotesDir: string): string {
  const [host] = relative(remotesDir, remotePath).split('/');
  return host ?? '';
}

/** Generate unified diffs for remote files against a base */
export function generateFileDiffs(
  mergedPath: string | null,
  remotes: string[],
  remotesDir: string
): DiffSet {
  const firstRemote = remotes[0];
  if (firstRemote === undefined) {
    throw new Error('generateFileDiffs requires at least one remote path');
  }
  const useMerged = hasText(mergedPath) && existsSync(mergedPath);
  const basePath = useMerged ? mergedPath : firstRemote;
  const baseLabel = useMerged ? 'current merged' : hostFromPath(firstRemote, remotesDir);

  const diffs: DiffSet['diffs'] = [];
  for (const remote of remotes) {
    if (remote === basePath) {
      continue;
    }
    const host = hostFromPath(remote, remotesDir);
    diffs.push({ host, diff: runDiff(basePath, remote) });
  }
  return { basePath, baseLabel, diffs };
}

/** Generate unified diffs for remote directories against a base */
export function generateDirDiffs(
  mergedDir: string | null,
  remoteDirs: string[],
  remotesDir: string
): DiffSet {
  const firstRemoteDir = remoteDirs[0];
  if (firstRemoteDir === undefined) {
    throw new Error('generateDirDiffs requires at least one remote directory');
  }
  const useMerged = hasText(mergedDir) && existsSync(mergedDir);
  const baseDir = useMerged ? mergedDir : firstRemoteDir;
  const baseLabel = useMerged ? 'current merged' : hostFromPath(firstRemoteDir, remotesDir);

  // Collect the union of all relative paths
  const allRelPaths = new Set<string>();
  for (const rel of collectFiles(baseDir)) {
    allRelPaths.add(rel);
  }
  for (const dir of remoteDirs) {
    if (dir === baseDir) {
      continue;
    }
    for (const rel of collectFiles(dir)) {
      allRelPaths.add(rel);
    }
  }

  const diffs: DiffSet['diffs'] = [];
  for (const dir of remoteDirs) {
    if (dir === baseDir) {
      continue;
    }
    const host = hostFromPath(dir, remotesDir);
    const fileDiffs: string[] = [];
    for (const rel of [...allRelPaths].sort()) {
      const baseFile = join(baseDir, rel);
      const otherFile = join(dir, rel);
      const baseExists = existsSync(baseFile);
      const otherExists = existsSync(otherFile);

      if (baseExists && otherExists) {
        const d = runDiff(baseFile, otherFile);
        if (d !== '') {
          fileDiffs.push(`=== ${rel} ===\n${d}`);
        }
      } else if (baseExists && !otherExists) {
        fileDiffs.push(`=== ${rel} ===\n(file removed by ${host})`);
      } else if (!baseExists && otherExists) {
        fileDiffs.push(`=== ${rel} ===\n(new file added by ${host})`);
      }
    }
    diffs.push({ host, diff: fileDiffs.join('\n') });
  }
  return { basePath: baseDir, baseLabel, diffs };
}
