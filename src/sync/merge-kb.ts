import { existsSync, readdirSync, mkdirSync } from 'fs';
import { resolve, relative } from 'path';
import { REMOTES_DIR, MERGED_DIR } from '../config.js';
import { debug } from '../log.js';
import { type ContentChange } from './changes.js';
import { type DiffSet } from './content-compare.js';
import { type MergeItem, fileMergeOps, mergeItems } from './merge-engine.js';

const EXCLUDED_PREFIXES = ['journal/', 'curiosity/'];

function isExcluded(relPath: string): boolean {
  return EXCLUDED_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function globMd(dir: string): string[] {
  const results: string[] = [];
  function walk(current: string): void {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function findAllKbFiles(): Set<string> {
  const allFiles = new Set<string>();
  if (!existsSync(REMOTES_DIR)) return allFiles;

  for (const host of readdirSync(REMOTES_DIR)) {
    const kbDir = resolve(REMOTES_DIR, host, 'discord-kb');
    for (const mdFile of globMd(kbDir)) {
      const rel = relative(kbDir, mdFile);
      if (!isExcluded(rel)) {
        allFiles.add(rel);
      }
    }
  }
  return allFiles;
}

function findKbRemotes(kbFile: string): string[] {
  if (!existsSync(REMOTES_DIR)) return [];
  const remotes: string[] = [];
  for (const host of readdirSync(REMOTES_DIR)) {
    const remoteFile = resolve(REMOTES_DIR, host, 'discord-kb', kbFile);
    if (existsSync(remoteFile)) remotes.push(remoteFile);
  }
  return remotes;
}

function buildPrompt(item: MergeItem, { basePath, baseLabel, diffs }: DiffSet): string {
  const diffSections = diffs
    .map(({ host, diff }) => `--- Host: ${host} ---\n${diff || '(no changes from base)'}`)
    .join('\n\n');

  return [
    `Merge KB file using diff analysis:`,
    '',
    `File: ${item.name}`,
    `Base version: ${basePath} (from ${baseLabel} — read this file first)`,
    '',
    `Changes from each host (unified diff format):`,
    '',
    diffSections,
    '',
    `Requirements:`,
    `- Apply changes from all hosts to the base version`,
    `- Remove duplicates, keep most comprehensive versions`,
    `- Add source attribution for new/conflicting sections`,
    `- Maintain proper markdown structure`,
    `- Write result to merged/discord-kb/${item.name}`,
    '',
    'You are running non-interactively in an automated pipeline.',
    'Do not ask for permission or confirmation — proceed directly.',
    'Print brief summary when done.',
  ].join('\n');
}

export async function mergeKbDirectories(): Promise<ContentChange | null> {
  debug('Starting KB directory merge...');

  const mergedKb = resolve(MERGED_DIR, 'discord-kb');
  mkdirSync(mergedKb, { recursive: true });

  const allKbFiles = [...findAllKbFiles()].sort();
  debug(`Found ${allKbFiles.length} unique KB files (excluding journal/curiosity)`);

  const items: MergeItem[] = allKbFiles.map((kbFile) => ({
    name: kbFile,
    mergedPath: resolve(mergedKb, kbFile),
    remotePaths: findKbRemotes(kbFile),
    conflictKey: `kb:${kbFile}`,
  }));

  return mergeItems(items, {
    label: 'KB',
    ops: fileMergeOps,
    allowedTools: 'Read,Write',
    onClaudeFail: 'conflict',
    buildPrompt,
  });
}
