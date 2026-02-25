import { existsSync, statSync, mkdirSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, relative } from 'path';
import { cpSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { REMOTES_DIR, MERGED_DIR, DATA_DIR } from '../config.js';
import { debug, warn } from '../log.js';
import { rsyncMirror } from '../ssh.js';

function findAllSkills(): Set<string> {
  const skills = new Set<string>();
  if (!existsSync(REMOTES_DIR)) return skills;

  for (const host of readdirSync(REMOTES_DIR)) {
    const skillsDir = resolve(REMOTES_DIR, host, '.claude', 'skills');
    if (!existsSync(skillsDir)) continue;
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) skills.add(entry.name);
    }
  }
  return skills;
}

function newestMtime(dir: string): number {
  let newest = 0;
  function walk(current: string): void {
    if (!existsSync(current)) return;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        const mtime = statSync(full).mtimeMs;
        if (mtime > newest) newest = mtime;
      }
    }
  }
  walk(dir);
  return newest;
}

function mergeSkillWithClaude(skillName: string, newerRemotes: string[]): boolean {
  debug(`  Multiple hosts updated skill '${skillName}' — using Claude to merge`);

  const tempDir = mkdtempSync(resolve(tmpdir(), 'devsync-skill-'));
  try {
    const dirDescriptions: string[] = [];
    for (const remotePath of newerRemotes) {
      const host = relative(REMOTES_DIR, remotePath).split('/')[0];
      const dest = resolve(tempDir, `${host}_${skillName}`);
      cpSync(remotePath, dest, { recursive: true });
      dirDescriptions.push(`- ${dest}/ (from ${host})`);
    }

    const prompt = [
      `Merge these Claude skill directories intelligently:`,
      '',
      `Skill: ${skillName}`,
      '',
      `Directories to merge:`,
      ...dirDescriptions,
      '',
      `Requirements:`,
      `- Combine unique functionality from each host's version`,
      `- Keep the most comprehensive and up-to-date content`,
      `- Preserve all unique files from each version`,
      `- Add comments noting source host for conflicting sections`,
      `- Maintain proper skill structure and format`,
      `- Write merged result to merged/.claude/skills/${skillName}/`,
      '',
      'Print brief summary when done.',
    ].join('\n');

    execFileSync(
      'claude',
      ['--allowedTools', 'Read,Write,Glob', '--model', 'sonnet', '-p', prompt],
      {
        cwd: DATA_DIR,
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

export async function mergeSkillsDirectories(): Promise<string | null> {
  debug('Starting skills directory merge...');

  const mergedSkills = resolve(MERGED_DIR, '.claude', 'skills');
  mkdirSync(mergedSkills, { recursive: true });

  const allSkills = [...findAllSkills()].sort();
  debug(`Found ${allSkills.length} unique skills`);

  let mergedCount = 0;

  for (const skillName of allSkills) {
    const mergedSkill = resolve(mergedSkills, skillName);
    const mergedMtime = existsSync(mergedSkill) ? newestMtime(mergedSkill) : 0;

    const newerRemotes: string[] = [];
    for (const host of readdirSync(REMOTES_DIR)) {
      const remoteSkill = resolve(REMOTES_DIR, host, '.claude', 'skills', skillName);
      if (existsSync(remoteSkill) && newestMtime(remoteSkill) > mergedMtime) {
        newerRemotes.push(remoteSkill);
      }
    }

    if (newerRemotes.length === 0) {
      continue;
    } else if (newerRemotes.length === 1) {
      const host = relative(REMOTES_DIR, newerRemotes[0]).split('/')[0];
      debug(`  ${skillName}: updated by ${host} — copying`);
      mkdirSync(mergedSkill, { recursive: true });
      await rsyncMirror(newerRemotes[0] + '/', mergedSkill + '/');
      mergedCount++;
    } else {
      mkdirSync(mergedSkill, { recursive: true });
      if (mergeSkillWithClaude(skillName, newerRemotes)) {
        debug(`  Merged skill '${skillName}' from ${newerRemotes.length} sources`);
        mergedCount++;
      } else {
        warn(`  Merge failed for skill '${skillName}' — using most recent`);
        const newest = newerRemotes.reduce((a, b) => (newestMtime(a) > newestMtime(b) ? a : b));
        await rsyncMirror(newest + '/', mergedSkill + '/');
        mergedCount++;
      }
    }
  }

  if (mergedCount === 0) return null;
  return `${mergedCount} skills`;
}
