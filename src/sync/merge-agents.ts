import { existsSync, statSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, relative } from 'path';
import { cpSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { REMOTES_DIR, MERGED_DIR, PROJECT_ROOT } from '../config.js';
import { debug, warn } from '../log.js';

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

function mergeAgentWithClaude(fileName: string, newerRemotes: string[]): boolean {
  debug(`  Multiple hosts updated agent '${fileName}' — using Claude to merge`);

  const tempDir = mkdtempSync(resolve(tmpdir(), 'devsync-agent-'));
  try {
    const fileDescriptions: string[] = [];
    for (const remotePath of newerRemotes) {
      const host = relative(REMOTES_DIR, remotePath).split('/')[0];
      const dest = resolve(tempDir, `${host}_${fileName}`);
      cpSync(remotePath, dest);
      fileDescriptions.push(`- ${dest} (from ${host})`);
    }

    const prompt = [
      `Merge these Claude agent definition files intelligently:`,
      '',
      `Agent file: ${fileName}`,
      '',
      `Files to merge:`,
      ...fileDescriptions,
      '',
      `Requirements:`,
      `- These are .md files that may contain YAML frontmatter`,
      `- Combine unique functionality from each host's version`,
      `- Keep the most comprehensive and up-to-date content`,
      `- Preserve YAML frontmatter fields from all versions`,
      `- Add comments noting source host for conflicting sections`,
      `- Write merged result to data/merged/.claude/agents/${fileName}`,
      '',
      'Print brief summary when done.',
    ].join('\n');

    execFileSync(
      'claude',
      ['--allowedTools', 'Read,Write,Glob', '--model', 'sonnet', '-p', prompt],
      {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
      },
    );
    return true;
  } catch {
    return false;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function mergeAgents(): Promise<string | null> {
  debug('Starting agents merge...');

  const mergedAgents = resolve(MERGED_DIR, '.claude', 'agents');
  mkdirSync(mergedAgents, { recursive: true });

  const allAgents = [...findAllAgents()].sort();
  debug(`Found ${allAgents.length} unique agent files`);

  let mergedCount = 0;

  for (const fileName of allAgents) {
    const mergedFile = resolve(mergedAgents, fileName);
    const mergedMtime = existsSync(mergedFile) ? statSync(mergedFile).mtimeMs : 0;

    const newerRemotes: string[] = [];
    for (const host of readdirSync(REMOTES_DIR)) {
      const remoteFile = resolve(REMOTES_DIR, host, '.claude', 'agents', fileName);
      if (existsSync(remoteFile) && statSync(remoteFile).mtimeMs > mergedMtime) {
        newerRemotes.push(remoteFile);
      }
    }

    if (newerRemotes.length === 0) {
      continue;
    } else if (newerRemotes.length === 1) {
      const host = relative(REMOTES_DIR, newerRemotes[0]).split('/')[0];
      debug(`  ${fileName}: updated by ${host} — copying`);
      copyFileSync(newerRemotes[0], mergedFile);
      mergedCount++;
    } else {
      if (mergeAgentWithClaude(fileName, newerRemotes)) {
        debug(`  Merged agent '${fileName}' from ${newerRemotes.length} sources`);
        mergedCount++;
      } else {
        warn(`  Merge failed for agent '${fileName}' — using most recent`);
        const newest = newerRemotes.reduce((a, b) =>
          statSync(a).mtimeMs > statSync(b).mtimeMs ? a : b,
        );
        copyFileSync(newest, mergedFile);
        mergedCount++;
      }
    }
  }

  if (mergedCount === 0) return null;
  return `${mergedCount} agents`;
}
