import { existsSync, statSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { REMOTES_DIR, MERGED_DIR, DATA_DIR } from '../config.js';
import { debug, warn, error } from '../log.js';
import { filesAreIdentical, generateFileDiffs } from './content-compare.js';
import { type ContentChange, computeDiffStats, formatDiffBar } from './changes.js';

function findRemoteFiles(remoteFilename: string): string[] {
  if (!existsSync(REMOTES_DIR)) return [];
  return readdirSync(REMOTES_DIR)
    .map((host) => resolve(REMOTES_DIR, host, remoteFilename))
    .filter((f) => existsSync(f) && statSync(f).isFile());
}

function mergeClaudeFile(
  remoteFilename: string,
  mergedFilename: string,
  label: string,
): ContentChange | null {
  const remoteFiles = findRemoteFiles(remoteFilename);
  const mergedFile = resolve(MERGED_DIR, mergedFilename);
  if (remoteFiles.length === 0) {
    if (existsSync(mergedFile)) {
      debug(`No remote ${label} files found. Keeping existing merged version.`);
    } else {
      warn(`No ${label} files found in remotes/ or merged/.`);
    }
    return null;
  }

  debug(`Found ${remoteFiles.length} ${label} files`);
  mkdirSync(MERGED_DIR, { recursive: true });

  let needMerge = true;
  if (existsSync(mergedFile)) {
    const mergedMtime = statSync(mergedFile).mtimeMs;
    needMerge = remoteFiles.some((f) => statSync(f).mtimeMs > mergedMtime);
    if (!needMerge) {
      debug(`No remote ${label} files changed since last merge. Skipping.`);
      return null;
    }
  }

  // Snapshot old content for diff bar
  const existed = existsSync(mergedFile);
  const oldContent = existed ? readFileSync(mergedFile, 'utf-8') : null;

  // If all remotes have identical content, skip Claude merge
  if (filesAreIdentical(remoteFiles)) {
    debug(`All remote ${label} files are identical — copying without merge.`);
    writeFileSync(mergedFile, readFileSync(remoteFiles[0]));
  } else {
    const { basePath, baseLabel, diffs } = generateFileDiffs(
      existsSync(mergedFile) ? mergedFile : null,
      remoteFiles,
      REMOTES_DIR,
    );

    const diffSections = diffs
      .map(({ host, diff }) => `--- Host: ${host} ---\n${diff || '(no changes from base)'}`)
      .join('\n\n');

    const prompt = [
      `Merge ${label} files using diff analysis:`,
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
      `- Write result to merged/${mergedFilename}`,
      '',
      'You are running non-interactively in an automated pipeline.',
      'Do not ask for permission or confirmation — proceed directly.',
      'Print brief summary when done.',
    ].join('\n');

    debug(`Invoking Claude Code to merge ${label} files...`);
    try {
      execFileSync(
        'claude',
        [
          '--allowedTools',
          'Read,Write,Glob',
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
          stdio: 'pipe',
        },
      );
    } catch {
      error(`${label} merge failed`);
      process.exit(1);
    }

    if (!existsSync(mergedFile)) {
      error(`Merged ${label} not created at expected location`);
      process.exit(1);
    }
  }

  // Build change info
  const type = existed ? '~' : '+';
  let diffBar: string | undefined;
  if (existed && oldContent) {
    try {
      const newContent = readFileSync(mergedFile, 'utf-8');
      if (oldContent === newContent) return null; // no actual change
      const stats = computeDiffStats(oldContent, newContent);
      if (stats.added > 0 || stats.removed > 0) {
        diffBar = formatDiffBar(stats.added, stats.removed);
      }
    } catch {
      /* skip */
    }
  }

  return { label, files: [{ name: mergedFilename, type, diffBar }] };
}

export function mergeUserClaudeMd(): ContentChange | null {
  return mergeClaudeFile('user-CLAUDE.md', 'user-CLAUDE.md', 'user CLAUDE.md');
}

export function mergeClaudeLocalMd(): ContentChange | null {
  return mergeClaudeFile('CLAUDE.local.md', 'CLAUDE.local.md', 'CLAUDE.local.md');
}
