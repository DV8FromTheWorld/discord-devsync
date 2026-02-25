import { readFileSync, readdirSync, existsSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, relative, join } from 'path';

/** True if all files have byte-identical content */
export function filesAreIdentical(paths: string[]): boolean {
  if (paths.length < 2) return true;
  const first = readFileSync(paths[0], 'utf-8');
  for (let i = 1; i < paths.length; i++) {
    if (readFileSync(paths[i], 'utf-8') !== first) return false;
  }
  return true;
}

/** Collect sorted relative paths for all files in a directory, skipping .DS_Store */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  function walk(current: string): void {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
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
  if (paths.length < 2) return true;

  const firstFiles = collectFiles(paths[0]);
  for (let i = 1; i < paths.length; i++) {
    const otherFiles = collectFiles(paths[i]);
    if (firstFiles.length !== otherFiles.length) return false;
    for (let j = 0; j < firstFiles.length; j++) {
      if (firstFiles[j] !== otherFiles[j]) return false;
    }
    // Same structure — compare file contents
    for (const rel of firstFiles) {
      const a = readFileSync(resolve(paths[0], rel), 'utf-8');
      const b = readFileSync(resolve(paths[i], rel), 'utf-8');
      if (a !== b) return false;
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
  return relative(remotesDir, remotePath).split('/')[0];
}

/** Generate unified diffs for remote files against a base */
export function generateFileDiffs(
  mergedPath: string | null,
  remotes: string[],
  remotesDir: string,
): DiffSet {
  const basePath = mergedPath && existsSync(mergedPath) ? mergedPath : remotes[0];
  const baseLabel = mergedPath && existsSync(mergedPath)
    ? 'current merged'
    : hostFromPath(remotes[0], remotesDir);

  const diffs: DiffSet['diffs'] = [];
  for (const remote of remotes) {
    if (remote === basePath) continue;
    const host = hostFromPath(remote, remotesDir);
    diffs.push({ host, diff: runDiff(basePath, remote) });
  }
  return { basePath, baseLabel, diffs };
}

/** Generate unified diffs for remote directories against a base */
export function generateDirDiffs(
  mergedDir: string | null,
  remoteDirs: string[],
  remotesDir: string,
): DiffSet {
  const baseDir = mergedDir && existsSync(mergedDir) ? mergedDir : remoteDirs[0];
  const baseLabel = mergedDir && existsSync(mergedDir)
    ? 'current merged'
    : hostFromPath(remoteDirs[0], remotesDir);

  // Collect the union of all relative paths
  const allRelPaths = new Set<string>();
  for (const rel of collectFiles(baseDir)) allRelPaths.add(rel);
  for (const dir of remoteDirs) {
    if (dir === baseDir) continue;
    for (const rel of collectFiles(dir)) allRelPaths.add(rel);
  }

  const diffs: DiffSet['diffs'] = [];
  for (const dir of remoteDirs) {
    if (dir === baseDir) continue;
    const host = hostFromPath(dir, remotesDir);
    const fileDiffs: string[] = [];
    for (const rel of [...allRelPaths].sort()) {
      const baseFile = join(baseDir, rel);
      const otherFile = join(dir, rel);
      const baseExists = existsSync(baseFile);
      const otherExists = existsSync(otherFile);

      if (baseExists && otherExists) {
        const d = runDiff(baseFile, otherFile);
        if (d) fileDiffs.push(`=== ${rel} ===\n${d}`);
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
