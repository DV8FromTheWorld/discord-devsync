import { existsSync, statSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { REMOTES_DIR, MERGED_DIR, PROJECT_ROOT } from '../config.js';
import { info, success, warn, error } from '../log.js';

function findRemoteClaudes(): string[] {
  if (!existsSync(REMOTES_DIR)) return [];
  return readdirSync(REMOTES_DIR)
    .map((host) => resolve(REMOTES_DIR, host, 'CLAUDE.md'))
    .filter((f) => existsSync(f));
}

export function mergeClaudeMd(): void {
  const remoteFiles = findRemoteClaudes();
  if (remoteFiles.length === 0) {
    error("No CLAUDE.md files found in remotes/. Run 'fetch' first.", 'merge');
    process.exit(1);
  }

  info(`Found ${remoteFiles.length} CLAUDE.md files`, 'merge');

  const mergedFile = resolve(MERGED_DIR, 'CLAUDE.md');
  mkdirSync(MERGED_DIR, { recursive: true });

  let needMerge = true;
  if (existsSync(mergedFile)) {
    const mergedMtime = statSync(mergedFile).mtimeMs;
    needMerge = remoteFiles.some((f) => statSync(f).mtimeMs > mergedMtime);
    if (!needMerge) {
      info('No remote CLAUDE.md files changed since last merge. Skipping.', 'merge');
      return;
    }
  }

  const prompt = [
    'Read all CLAUDE.md files in data/remotes/ and merge them intelligently:',
    '',
    '- Remove duplicates, keep most comprehensive versions',
    '- Preserve unique insights from each host',
    '- Maintain proper markdown structure',
    '- Write result to data/merged/CLAUDE.md',
    '',
    'Print brief summary when done.',
  ].join('\n');

  info('Invoking Claude Code to merge CLAUDE.md files...', 'merge');
  try {
    execFileSync(
      'claude',
      ['--allowedTools', 'Read,Write,Glob', '--model', 'sonnet', '-p', prompt],
      {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
      },
    );
  } catch {
    error('CLAUDE.md merge failed', 'merge');
    process.exit(1);
  }

  if (!existsSync(mergedFile)) {
    error('Merged CLAUDE.md not created at expected location', 'merge');
    process.exit(1);
  }

  success('CLAUDE.md merge completed', 'merge');
}
