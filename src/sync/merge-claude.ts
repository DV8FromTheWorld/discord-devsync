import { existsSync, statSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { REMOTES_DIR, MERGED_DIR, DATA_DIR } from '../config.js';
import { debug, warn, error } from '../log.js';
import { filesAreIdentical, generateFileDiffs } from './content-compare.js';

function findRemoteClaudes(): string[] {
  if (!existsSync(REMOTES_DIR)) return [];
  return readdirSync(REMOTES_DIR)
    .map((host) => resolve(REMOTES_DIR, host, 'CLAUDE.md'))
    .filter((f) => existsSync(f));
}

export function mergeClaudeMd(): string | null {
  const remoteFiles = findRemoteClaudes();
  const mergedFile = resolve(MERGED_DIR, 'CLAUDE.md');
  if (remoteFiles.length === 0) {
    if (existsSync(mergedFile)) {
      debug('No remote CLAUDE.md files found. Keeping existing merged version.');
    } else {
      warn('No CLAUDE.md files found in remotes/ or merged/.');
    }
    return null;
  }

  debug(`Found ${remoteFiles.length} CLAUDE.md files`);
  mkdirSync(MERGED_DIR, { recursive: true });

  let needMerge = true;
  if (existsSync(mergedFile)) {
    const mergedMtime = statSync(mergedFile).mtimeMs;
    needMerge = remoteFiles.some((f) => statSync(f).mtimeMs > mergedMtime);
    if (!needMerge) {
      debug('No remote CLAUDE.md files changed since last merge. Skipping.');
      return null;
    }
  }

  // If all remotes have identical content, skip Claude merge
  if (filesAreIdentical(remoteFiles)) {
    debug('All remote CLAUDE.md files are identical — copying without merge.');
    copyFileSync(remoteFiles[0], mergedFile);
    return 'CLAUDE.md';
  }

  const { basePath, baseLabel, diffs } = generateFileDiffs(
    existsSync(mergedFile) ? mergedFile : null,
    remoteFiles,
    REMOTES_DIR,
  );

  const diffSections = diffs.map(({ host, diff }) =>
    `--- Host: ${host} ---\n${diff || '(no changes from base)'}`,
  ).join('\n\n');

  const prompt = [
    'Merge CLAUDE.md files using diff analysis:',
    '',
    `Base version: ${basePath} (from ${baseLabel} — read this file first)`,
    '',
    'Changes from each host (unified diff format):',
    '',
    diffSections,
    '',
    '- Apply changes from all hosts to the base version',
    '- Remove duplicates, keep most comprehensive versions',
    '- Preserve unique insights from each host',
    '- Maintain proper markdown structure',
    '- Write result to merged/CLAUDE.md',
    '',
    'Print brief summary when done.',
  ].join('\n');

  debug('Invoking Claude Code to merge CLAUDE.md files...');
  try {
    execFileSync(
      'claude',
      ['--allowedTools', 'Read,Write,Glob', '--model', 'sonnet', '-p', prompt],
      {
        cwd: DATA_DIR,
        stdio: 'inherit',
      },
    );
  } catch {
    error('CLAUDE.md merge failed');
    process.exit(1);
  }

  if (!existsSync(mergedFile)) {
    error('Merged CLAUDE.md not created at expected location');
    process.exit(1);
  }

  return 'CLAUDE.md';
}
