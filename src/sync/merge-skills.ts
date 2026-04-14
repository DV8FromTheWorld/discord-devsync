import { existsSync, readdirSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, MERGED_DIR } from '../config.js';
import { debug } from '../log.js';
import { type ContentChange } from './changes.js';
import { type DiffSet } from './content-compare.js';
import { type MergeItem, dirMergeOps, mergeItems } from './merge-engine.js';

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

function findSkillRemotes(skillName: string): string[] {
  if (!existsSync(REMOTES_DIR)) return [];
  const remotes: string[] = [];
  for (const host of readdirSync(REMOTES_DIR)) {
    const remoteSkill = resolve(REMOTES_DIR, host, '.claude', 'skills', skillName);
    if (existsSync(remoteSkill)) remotes.push(remoteSkill);
  }
  return remotes;
}

function buildPrompt(item: MergeItem, { basePath, baseLabel, diffs }: DiffSet): string {
  const diffSections = diffs
    .map(({ host, diff }) => `--- Host: ${host} ---\n${diff || '(no changes from base)'}`)
    .join('\n\n');

  return [
    `Merge Claude skill directories using diff analysis:`,
    '',
    `Skill: ${item.name}`,
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
    `- Write merged result to merged/.claude/skills/${item.name}/`,
    '',
    'You are running non-interactively in an automated pipeline.',
    'Do not ask for permission or confirmation — proceed directly.',
    'Print brief summary when done.',
  ].join('\n');
}

export async function mergeSkillsDirectories(): Promise<ContentChange | null> {
  debug('Starting skills directory merge...');

  const mergedSkills = resolve(MERGED_DIR, '.claude', 'skills');
  mkdirSync(mergedSkills, { recursive: true });

  const allSkills = [...findAllSkills()].sort();
  debug(`Found ${allSkills.length} unique skills`);

  const items: MergeItem[] = allSkills.map((skillName) => ({
    name: skillName,
    mergedPath: resolve(mergedSkills, skillName),
    remotePaths: findSkillRemotes(skillName),
    conflictKey: `skills:${skillName}`,
  }));

  return mergeItems(items, {
    label: 'skills',
    ops: dirMergeOps,
    allowedTools: 'Read,Write,Glob',
    onClaudeFail: 'conflict',
    nameSuffix: '/',
    buildPrompt,
  });
}
