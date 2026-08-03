import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, utimesSync } from 'fs';
import { basename, relative, resolve } from 'path';

import { MERGED_DIR, REMOTES_DIR } from '../config.js';
import { debug } from '../log.js';
import { type ContentChange, type FileChange } from './changes.js';
import { type DiffSet } from './content-compare.js';
import { fileMergeOps, type MergeItem, mergeItems } from './merge-engine.js';

const EXCLUDED_PREFIXES = ['journal/', 'curiosity/'];

// OS and editor droppings. Each host generates these independently, so they have no
// shared history to merge — syncing them just churns the KB and pushes noise back out.
const EXCLUDED_FILENAMES = new Set(['.DS_Store', '._.DS_Store', 'Thumbs.db', 'desktop.ini']);

function isExcluded(relPath: string): boolean {
  if (EXCLUDED_PREFIXES.some((prefix) => relPath.startsWith(prefix))) {
    return true;
  }
  return EXCLUDED_FILENAMES.has(basename(relPath));
}

function globFiles(dir: string, filter: (name: string) => boolean): string[] {
  const results: string[] = [];
  function walk(current: string): void {
    if (!existsSync(current)) {
      return;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (filter(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function globMd(dir: string): string[] {
  return globFiles(dir, (name) => name.endsWith('.md'));
}

function globNonMd(dir: string): string[] {
  return globFiles(dir, (name) => !name.endsWith('.md'));
}

function findAllKbFiles(): Set<string> {
  const allFiles = new Set<string>();
  if (!existsSync(REMOTES_DIR)) {
    return allFiles;
  }

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

function findAllNonMdKbFiles(): Set<string> {
  const allFiles = new Set<string>();
  if (!existsSync(REMOTES_DIR)) {
    return allFiles;
  }

  for (const host of readdirSync(REMOTES_DIR)) {
    const kbDir = resolve(REMOTES_DIR, host, 'discord-kb');
    for (const file of globNonMd(kbDir)) {
      const rel = relative(kbDir, file);
      if (!isExcluded(rel)) {
        allFiles.add(rel);
      }
    }
  }
  return allFiles;
}

function findKbRemotes(kbFile: string): string[] {
  if (!existsSync(REMOTES_DIR)) {
    return [];
  }
  const remotes: string[] = [];
  for (const host of readdirSync(REMOTES_DIR)) {
    const remoteFile = resolve(REMOTES_DIR, host, 'discord-kb', kbFile);
    if (existsSync(remoteFile)) {
      remotes.push(remoteFile);
    }
  }
  return remotes;
}

function buildPrompt(item: MergeItem, { basePath, baseLabel, diffs }: DiffSet): string {
  const diffSections = diffs
    .map(
      ({ host, diff }) => `--- Host: ${host} ---\n${diff !== '' ? diff : '(no changes from base)'}`
    )
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

  // Merge .md files via the merge engine (supports three-way merge with Claude)
  const allKbFiles = [...findAllKbFiles()].sort();
  debug(`Found ${allKbFiles.length} unique KB markdown files (excluding journal/curiosity)`);

  const items: MergeItem[] = allKbFiles.map((kbFile) => ({
    name: kbFile,
    mergedPath: resolve(mergedKb, kbFile),
    remotePaths: findKbRemotes(kbFile),
    conflictKey: `kb:${kbFile}`,
  }));

  const mdChange = await mergeItems(items, {
    label: 'KB',
    ops: fileMergeOps,
    allowedTools: 'Read,Write',
    buildPrompt,
  });

  // Pass through non-md files with last-modified-wins (no merge, no Claude)
  const nonMdFiles = [...findAllNonMdKbFiles()].sort();
  const nonMdChanges: FileChange[] = [];

  if (nonMdFiles.length > 0) {
    debug(`Found ${nonMdFiles.length} non-markdown KB files — using last-modified-wins`);

    for (const kbFile of nonMdFiles) {
      const mergedPath = resolve(mergedKb, kbFile);
      const remotePaths = findKbRemotes(kbFile);
      if (remotePaths.length === 0) {
        continue;
      }

      // Pick the newest version by mtime. Remotes are fetched with `rsync -a`, which
      // preserves times, so these are the original mtimes from each host.
      let newestPath = remotePaths[0];
      if (newestPath === undefined) {
        continue;
      }
      let newestStat = statSync(newestPath);
      for (const remotePath of remotePaths.slice(1)) {
        const remoteStat = statSync(remotePath);
        if (remoteStat.mtimeMs > newestStat.mtimeMs) {
          newestPath = remotePath;
          newestStat = remoteStat;
        }
      }

      // Skip if merged already holds this version. The merged file carries the winning
      // remote's mtime (see utimesSync below), so this compares source mtime to source
      // mtime rather than to whenever we happened to copy.
      const existed = existsSync(mergedPath);
      if (existed && statSync(mergedPath).mtimeMs >= newestStat.mtimeMs) {
        continue;
      }

      mkdirSync(resolve(mergedPath, '..'), { recursive: true });
      copyFileSync(newestPath, mergedPath);

      // copyFileSync stamps the copy with the current time, which would leave merged
      // looking newer than every remote — stranding a version from another host whose
      // mtime falls between the previous winner's and the copy. Carry the source mtime
      // over so last-modified-wins stays comparable across hosts and across runs.
      utimesSync(mergedPath, newestStat.atime, newestStat.mtime);

      const host = relative(REMOTES_DIR, newestPath).split('/')[0] ?? '';
      debug(`  ${kbFile}: copied from ${host} (last-modified-wins)`);
      nonMdChanges.push({ name: kbFile, type: existed ? '~' : '+', note: `from ${host}` });
    }
  }

  const allFiles = [...(mdChange?.files ?? []), ...nonMdChanges];
  if (allFiles.length === 0) {
    return null;
  }
  return { label: 'KB', files: allFiles };
}
