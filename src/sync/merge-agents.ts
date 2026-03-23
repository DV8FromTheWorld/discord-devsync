import { existsSync, statSync, mkdirSync, readdirSync, copyFileSync, readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, relative } from 'path';
import { REMOTES_DIR, MERGED_DIR, DATA_DIR } from '../config.js';
import { debug, warn } from '../log.js';
import { filesAreIdentical, generateFileDiffs } from './content-compare.js';
import { type ContentChange, type FileChange, computeDiffStats, formatDiffBar } from './changes.js';

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

function mergeAgentWithClaude(
  fileName: string,
  mergedFile: string,
  newerRemotes: string[],
): boolean {
  debug(`  Multiple hosts updated agent '${fileName}' — using Claude to merge`);

  const { basePath, baseLabel, diffs } = generateFileDiffs(
    existsSync(mergedFile) ? mergedFile : null,
    newerRemotes,
    REMOTES_DIR,
  );

  const diffSections = diffs
    .map(({ host, diff }) => `--- Host: ${host} ---\n${diff || '(no changes from base)'}`)
    .join('\n\n');

  const prompt = [
    `Merge agent definition files intelligently using diff analysis:`,
    '',
    `Agent file: ${fileName}`,
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
    `- Write merged result to merged/.claude/agents/${fileName}`,
    '',
    'You are running non-interactively in an automated pipeline.',
    'Do not ask for permission or confirmation — proceed directly.',
    'Print brief summary of merge decisions.',
  ].join('\n');

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
        stdio: 'inherit',
      },
    );
    return true;
  } catch {
    return false;
  }
}

export async function mergeAgents(): Promise<ContentChange | null> {
  debug('Starting agents merge...');

  const mergedAgents = resolve(MERGED_DIR, '.claude', 'agents');
  mkdirSync(mergedAgents, { recursive: true });

  const allAgents = [...findAllAgents()].sort();
  debug(`Found ${allAgents.length} unique agent files`);

  const files: FileChange[] = [];

  for (const fileName of allAgents) {
    const mergedFile = resolve(mergedAgents, fileName);
    const existed = existsSync(mergedFile);
    const oldContent = existed ? readFileSync(mergedFile, 'utf-8') : null;
    const mergedMtime = existed ? statSync(mergedFile).mtimeMs : 0;

    const newerRemotes: string[] = [];
    for (const host of readdirSync(REMOTES_DIR)) {
      const remoteFile = resolve(REMOTES_DIR, host, '.claude', 'agents', fileName);
      if (existsSync(remoteFile) && statSync(remoteFile).mtimeMs > mergedMtime) {
        newerRemotes.push(remoteFile);
      }
    }

    if (newerRemotes.length === 0) {
      continue;
    }

    let claudeMerge = false;

    if (newerRemotes.length === 1) {
      const host = relative(REMOTES_DIR, newerRemotes[0]).split('/')[0];
      debug(`  ${fileName}: updated by ${host} — copying`);
      copyFileSync(newerRemotes[0], mergedFile);
    } else {
      if (filesAreIdentical(newerRemotes)) {
        debug(`  ${fileName}: ${newerRemotes.length} hosts updated, content identical — copying`);
        copyFileSync(newerRemotes[0], mergedFile);
      } else if (mergeAgentWithClaude(fileName, mergedFile, newerRemotes)) {
        debug(`  Merged agent '${fileName}' from ${newerRemotes.length} sources`);
        claudeMerge = true;
      } else {
        warn(`  Merge failed for agent '${fileName}' — using most recent`);
        const newest = newerRemotes.reduce((a, b) =>
          statSync(a).mtimeMs > statSync(b).mtimeMs ? a : b,
        );
        copyFileSync(newest, mergedFile);
      }
    }

    // Check if content actually changed
    if (existed && oldContent) {
      try {
        const newContent = readFileSync(mergedFile, 'utf-8');
        if (oldContent === newContent) continue;
      } catch {
        /* skip */
      }
    }

    const fc: FileChange = { name: fileName, type: existed ? '~' : '+' };

    if (existed && oldContent) {
      try {
        const newContent = readFileSync(mergedFile, 'utf-8');
        const stats = computeDiffStats(oldContent, newContent);
        if (stats.added > 0 || stats.removed > 0) {
          fc.diffBar = formatDiffBar(stats.added, stats.removed);
        }
      } catch {
        /* skip */
      }
    }

    if (claudeMerge) {
      fc.note = 'conflict resolved via Claude';
    }

    files.push(fc);
  }

  if (files.length === 0) return null;
  return { label: 'agents', files };
}
