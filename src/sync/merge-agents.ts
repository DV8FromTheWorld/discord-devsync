import { existsSync, readdirSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, MERGED_DIR } from '../config.js';
import { debug } from '../log.js';
import { type ContentChange } from './changes.js';
import { type DiffSet } from './content-compare.js';
import { type MergeItem, fileMergeOps, mergeItems } from './merge-engine.js';

function findAllAgents(): Set<string> {
  const agents = new Set<string>();
  if (!existsSync(REMOTES_DIR)) return agents;

  for (const host of readdirSync(REMOTES_DIR)) {
    const agentsDir = resolve(REMOTES_DIR, host, '.claude', 'agents');
    if (!existsSync(agentsDir)) continue;
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md')) agents.add(entry.name);
    }
  }
  return agents;
}

function findAgentRemotes(fileName: string): string[] {
  if (!existsSync(REMOTES_DIR)) return [];
  const remotes: string[] = [];
  for (const host of readdirSync(REMOTES_DIR)) {
    const remoteFile = resolve(REMOTES_DIR, host, '.claude', 'agents', fileName);
    if (existsSync(remoteFile)) remotes.push(remoteFile);
  }
  return remotes;
}

function buildPrompt(item: MergeItem, { basePath, baseLabel, diffs }: DiffSet): string {
  const diffSections = diffs
    .map(({ host, diff }) => `--- Host: ${host} ---\n${diff || '(no changes from base)'}`)
    .join('\n\n');

  return [
    `Merge agent definition files intelligently using diff analysis:`,
    '',
    `Agent file: ${item.name}`,
    `Base version: ${basePath} (from ${baseLabel} — read this file first)`,
    '',
    `Changes from each host (unified diff format):`,
    '',
    diffSections,
    '',
    `Requirements:`,
    `- Apply changes from all hosts to the base version`,
    `- When hosts make conflicting changes, keep the most comprehensive version`,
    `- These are .md files that may contain YAML frontmatter`,
    `- Preserve YAML frontmatter fields from all versions`,
    `- Write merged result to merged/.claude/agents/${item.name}`,
    '',
    'You are running non-interactively in an automated pipeline.',
    'Do not ask for permission or confirmation — proceed directly.',
    'Print brief summary of merge decisions.',
  ].join('\n');
}

export async function mergeAgents(): Promise<ContentChange | null> {
  debug('Starting agents merge...');

  const mergedAgents = resolve(MERGED_DIR, '.claude', 'agents');
  mkdirSync(mergedAgents, { recursive: true });

  const allAgents = [...findAllAgents()].sort();
  debug(`Found ${allAgents.length} unique agent files`);

  const items: MergeItem[] = allAgents.map((fileName) => ({
    name: fileName,
    mergedPath: resolve(mergedAgents, fileName),
    remotePaths: findAgentRemotes(fileName),
    conflictKey: `agents:${fileName}`,
  }));

  return mergeItems(items, {
    label: 'agents',
    ops: fileMergeOps,
    allowedTools: 'Read,Write,Glob',
    onClaudeFail: 'conflict',
    buildPrompt,
  });
}
