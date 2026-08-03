import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

import { MERGED_DIR, REMOTES_DIR } from '../config.js';
import { debug } from '../log.js';
import { type ContentChange } from './changes.js';
import { type DiffSet } from './content-compare.js';
import { fileMergeOps, type MergeItem, mergeItems } from './merge-engine.js';

/**
 * Conflict-tracking key for a merged CLAUDE file.
 *
 * Push reads the same keys to decide what to skip, so both sides must agree on the exact
 * string — hence one shared function rather than a convention each end re-derives.
 * Matches the `kb:` / `skills:` / `agents:` prefixing used by the other layers.
 */
export function claudeConflictKey(mergedFilename: string): string {
  return `claude:${mergedFilename}`;
}

function findRemoteFiles(remoteFilename: string): string[] {
  if (!existsSync(REMOTES_DIR)) {
    return [];
  }
  return readdirSync(REMOTES_DIR)
    .map((host) => resolve(REMOTES_DIR, host, remoteFilename))
    .filter((f) => existsSync(f) && statSync(f).isFile());
}

function buildPrompt(item: MergeItem, { basePath, baseLabel, diffs }: DiffSet): string {
  const diffSections = diffs
    .map(
      ({ host, diff }) => `--- Host: ${host} ---\n${diff !== '' ? diff : '(no changes from base)'}`
    )
    .join('\n\n');

  return [
    `Merge ${item.name} files using diff analysis:`,
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
    `- Write result to merged/${item.name}`,
    '',
    'You are running non-interactively in an automated pipeline.',
    'Do not ask for permission or confirmation — proceed directly.',
    'Print brief summary when done.',
  ].join('\n');
}

async function mergeClaudeFile(
  remoteFilename: string,
  mergedFilename: string,
  label: string
): Promise<ContentChange | null> {
  const remoteFiles = findRemoteFiles(remoteFilename);
  const mergedFile = resolve(MERGED_DIR, mergedFilename);

  if (remoteFiles.length === 0) {
    if (existsSync(mergedFile)) {
      debug(`No remote ${label} files found. Keeping existing merged version.`);
    } else {
      debug(`No ${label} files found in remotes/ or merged/.`);
    }
    return null;
  }

  debug(`Found ${remoteFiles.length} ${label} files`);
  mkdirSync(MERGED_DIR, { recursive: true });

  return mergeItems(
    [
      {
        name: mergedFilename,
        mergedPath: mergedFile,
        remotePaths: remoteFiles,
        conflictKey: claudeConflictKey(mergedFilename),
      },
    ],
    {
      label,
      ops: fileMergeOps,
      allowedTools: 'Read,Write,Glob',
      buildPrompt,
    }
  );
}

export function mergeUserClaudeMd(): Promise<ContentChange | null> {
  return mergeClaudeFile('user-CLAUDE.md', 'user-CLAUDE.md', 'user CLAUDE.md');
}

export function mergeClaudeLocalMd(): Promise<ContentChange | null> {
  return mergeClaudeFile('CLAUDE.local.md', 'CLAUDE.local.md', 'CLAUDE.local.md');
}
