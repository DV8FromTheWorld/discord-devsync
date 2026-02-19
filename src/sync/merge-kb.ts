import { existsSync, statSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, relative } from 'path';
import { cpSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { REMOTES_DIR, MERGED_DIR, PROJECT_ROOT } from '../config.js';
import { info, success, warn } from '../log.js';

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

function mergeKbFileWithClaude(kbFile: string, newerRemotes: string[]): boolean {
  info(`  Multiple hosts updated ${kbFile} — using Claude to merge`, 'kb-merge');

  const tempDir = mkdtempSync(resolve(tmpdir(), 'devsync-kb-'));
  try {
    const fileDescriptions: string[] = [];
    for (const remotePath of newerRemotes) {
      const parts = remotePath.split('/');
      const remoteIdx = parts.indexOf('remotes');
      const host = parts[remoteIdx + 1];
      const destName = `${host}_${kbFile.replace(/\//g, '_')}`;
      copyFileSync(remotePath, resolve(tempDir, destName));
      fileDescriptions.push(`- ${resolve(tempDir, destName)} (from ${host})`);
    }

    const prompt = [
      `Merge these KB files intelligently:`,
      '',
      `Files to merge:`,
      ...fileDescriptions,
      '',
      `Requirements:`,
      `- Combine unique insights from each host`,
      `- Remove duplicates, keep most comprehensive versions`,
      `- Add source attribution for new/conflicting sections`,
      `- Maintain proper markdown structure`,
      `- Write result to data/merged/discord-kb/${kbFile}`,
      '',
      'Print brief summary when done.',
    ].join('\n');

    execFileSync('claude', ['--allowedTools', 'Read,Write', '--model', 'sonnet', '-p', prompt], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function mergeKbDirectories(): void {
  info('Starting KB directory merge...', 'kb-merge');

  const mergedKb = resolve(MERGED_DIR, 'discord-kb');
  mkdirSync(mergedKb, { recursive: true });

  const allKbFiles = [...findAllKbFiles()].sort();
  info(`Found ${allKbFiles.length} unique KB files (excluding journal/curiosity)`, 'kb-merge');

  for (const kbFile of allKbFiles) {
    const mergedFile = resolve(mergedKb, kbFile);
    const mergedMtime = existsSync(mergedFile) ? statSync(mergedFile).mtimeMs : 0;

    const newerRemotes: string[] = [];
    for (const host of readdirSync(REMOTES_DIR)) {
      const remoteFile = resolve(REMOTES_DIR, host, 'discord-kb', kbFile);
      if (existsSync(remoteFile) && statSync(remoteFile).mtimeMs > mergedMtime) {
        newerRemotes.push(remoteFile);
      }
    }

    if (newerRemotes.length === 0) {
      continue; // no changes
    } else if (newerRemotes.length === 1) {
      const host = relative(REMOTES_DIR, newerRemotes[0]).split('/')[0];
      info(`  ${kbFile}: updated by ${host} — copying`, 'kb-merge');
      mkdirSync(resolve(mergedFile, '..'), { recursive: true });
      copyFileSync(newerRemotes[0], mergedFile);
    } else {
      mkdirSync(resolve(mergedFile, '..'), { recursive: true });
      if (mergeKbFileWithClaude(kbFile, newerRemotes)) {
        success(`  Merged ${kbFile} from ${newerRemotes.length} sources`, 'kb-merge');
      } else {
        warn(`  Merge failed for ${kbFile} — using most recent version`, 'kb-merge');
        const newest = newerRemotes.reduce((a, b) =>
          statSync(a).mtimeMs > statSync(b).mtimeMs ? a : b,
        );
        copyFileSync(newest, mergedFile);
      }
    }
  }

  success('KB directory merge completed', 'kb-merge');
}
