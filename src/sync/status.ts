import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, MERGED_DIR } from '../config.js';
import { info } from '../log.js';

function globMdCount(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  function walk(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) count++;
    }
  }
  walk(dir);
  return count;
}

export function status(): void {
  info('Sync Status Report', 'status');
  console.log();
  console.log('Remote files:');

  if (existsSync(REMOTES_DIR)) {
    for (const host of readdirSync(REMOTES_DIR).sort()) {
      const hostDir = resolve(REMOTES_DIR, host);

      const claudeFile = resolve(hostDir, 'CLAUDE.md');
      if (existsSync(claudeFile)) {
        const lines = readFileSync(claudeFile, 'utf-8').split('\n').length;
        console.log(`  + ${host} CLAUDE.md: ${lines} lines`);
      } else {
        console.log(`  - ${host} CLAUDE.md: missing`);
      }

      const kbDir = resolve(hostDir, 'discord-kb');
      if (existsSync(kbDir)) {
        console.log(`  + ${host} KB: ${globMdCount(kbDir)} files`);
      } else {
        console.log(`  - ${host} KB: missing`);
      }

      const skillsDir = resolve(hostDir, '.claude', 'skills');
      if (existsSync(skillsDir)) {
        const skills = readdirSync(skillsDir, { withFileTypes: true }).filter((e) =>
          e.isDirectory(),
        );
        console.log(`  + ${host} skills: ${skills.length} skills`);
      } else {
        console.log(`  - ${host} skills: missing`);
      }
    }
  } else {
    console.log('  No remote files downloaded');
  }

  console.log();
  console.log('Merged files:');

  const claudeMerged = resolve(MERGED_DIR, 'CLAUDE.md');
  if (existsSync(claudeMerged)) {
    const lines = readFileSync(claudeMerged, 'utf-8').split('\n').length;
    console.log(`  + merged/CLAUDE.md: ${lines} lines`);
  } else {
    console.log('  - No merged CLAUDE.md');
  }

  const kbMerged = resolve(MERGED_DIR, 'discord-kb');
  if (existsSync(kbMerged)) {
    console.log(`  + merged/discord-kb: ${globMdCount(kbMerged)} files`);
  } else {
    console.log('  - No merged KB directory');
  }

  const skillsMerged = resolve(MERGED_DIR, '.claude', 'skills');
  if (existsSync(skillsMerged)) {
    const skills = readdirSync(skillsMerged, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    );
    console.log(`  + merged/skills: ${skills.length} skills`);
  } else {
    console.log('  - No merged skills directory');
  }
}
