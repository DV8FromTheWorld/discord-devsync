import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, MERGED_DIR } from '../config.js';
import { info, success } from '../log.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}\.md$/;

export function collectJournalEntries(): void {
  info('Collecting journal entries from remotes...', 'journal');

  const mergedJournal = resolve(MERGED_DIR, 'discord-kb', 'journal');
  mkdirSync(mergedJournal, { recursive: true });

  // Group journal files by date across all remotes
  const entriesByDate = new Map<string, { hostname: string; path: string }[]>();

  if (!existsSync(REMOTES_DIR)) return;

  for (const host of readdirSync(REMOTES_DIR)) {
    const journalDir = resolve(REMOTES_DIR, host, 'discord-kb', 'journal');
    if (!existsSync(journalDir)) continue;

    for (const file of readdirSync(journalDir)) {
      if (!DATE_PATTERN.test(file)) continue;
      const entries = entriesByDate.get(file) ?? [];
      entries.push({ hostname: host, path: resolve(journalDir, file) });
      entriesByDate.set(file, entries);
    }
  }

  if (entriesByDate.size === 0) {
    info('No journal entries found in remotes', 'journal');
    return;
  }

  info(`Found journal entries for ${entriesByDate.size} dates`, 'journal');

  for (const [dateFile, sources] of [...entriesByDate].sort()) {
    const mergedFile = resolve(mergedJournal, dateFile);

    if (sources.length === 1) {
      info(`  ${dateFile}: single source (${sources[0].hostname}) — copying`, 'journal');
      writeFileSync(mergedFile, readFileSync(sources[0].path, 'utf-8'));
    } else {
      const hostnames = sources.map((s) => s.hostname).join(', ');
      info(`  ${dateFile}: ${sources.length} sources (${hostnames}) — combining`, 'journal');
      const parts = sources.map((s) => {
        const content = readFileSync(s.path, 'utf-8').trimEnd();
        return `<!-- from ${s.hostname} -->\n${content}`;
      });
      writeFileSync(mergedFile, parts.join('\n\n') + '\n');
    }
  }

  success(`Collected journal entries for ${entriesByDate.size} dates`, 'journal');
}
