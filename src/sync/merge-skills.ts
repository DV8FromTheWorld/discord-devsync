import { existsSync, statSync, mkdirSync, readdirSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve, relative } from 'path';
import { REMOTES_DIR, MERGED_DIR, DATA_DIR } from '../config.js';
import { debug, warn } from '../log.js';
import { rsyncMirror } from '../ssh.js';
import { dirsAreIdentical, generateDirDiffs } from './content-compare.js';
import { type ContentChange, type FileChange } from './changes.js';

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

function mergeSkillWithClaude(
  skillName: string,
  mergedSkill: string,
  newerRemotes: string[],
): boolean {
  debug(`  Multiple hosts updated skill '${skillName}' — using Claude to merge`);

  const { basePath, baseLabel, diffs } = generateDirDiffs(
    existsSync(mergedSkill) ? mergedSkill : null,
    newerRemotes,
    REMOTES_DIR,
  );

  const diffSections = diffs
    .map(({ host, diff }) => `--- Host: ${host} ---\n${diff || '(no changes from base)'}`)
    .join('\n\n');

  const prompt = [
    `Merge Claude skill directories using diff analysis:`,
    '',
    `Skill: ${skillName}`,
    `Base version: ${basePath} (from ${baseLabel} — read this directory first)`,
    '',
    `Changes from each host (unified diff format):`,
    '',
    diffSections,
    '',
    `Requirements:`,
    `- Apply changes from all hosts to the base version`,
    `- Combine unique functionality from each host's version`,
    `- Keep the most comprehensive and up-to-date content`,
    `- Preserve all unique files from each version`,
    `- Add comments noting source host for conflicting sections`,
    `- Maintain proper skill structure and format`,
    `- Write merged result to merged/.claude/skills/${skillName}/`,
    '',
    'You are running non-interactively in an automated pipeline.',
    'Do not ask for permission or confirmation — proceed directly.',
    'Print brief summary when done.',
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

export async function mergeSkillsDirectories(): Promise<ContentChange | null> {
  debug('Starting skills directory merge...');

  const mergedSkills = resolve(MERGED_DIR, '.claude', 'skills');
  mkdirSync(mergedSkills, { recursive: true });

  const allSkills = [...findAllSkills()].sort();
  debug(`Found ${allSkills.length} unique skills`);

  const files: FileChange[] = [];

  for (const skillName of allSkills) {
    const mergedSkill = resolve(mergedSkills, skillName);
    const existed = existsSync(mergedSkill);
    const mergedMtime = existed ? newestMtime(mergedSkill) : 0;

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
    } else {
      mkdirSync(mergedSkill, { recursive: true });
      // If all remotes are identical, skip Claude merge
      if (dirsAreIdentical(newerRemotes)) {
        debug(`  ${skillName}: ${newerRemotes.length} hosts updated, content identical — copying`);
        await rsyncMirror(newerRemotes[0] + '/', mergedSkill + '/');
      } else if (mergeSkillWithClaude(skillName, mergedSkill, newerRemotes)) {
        debug(`  Merged skill '${skillName}' from ${newerRemotes.length} sources`);
      } else {
        warn(`  Merge failed for skill '${skillName}' — using most recent`);
        const newest = newerRemotes.reduce((a, b) => (newestMtime(a) > newestMtime(b) ? a : b));
        await rsyncMirror(newest + '/', mergedSkill + '/');
      }
    }

    files.push({ name: skillName + '/', type: existed ? '~' : '+' });
  }

  if (files.length === 0) return null;
  return { label: 'skills', files };
}
