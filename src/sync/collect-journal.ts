import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, MERGED_DIR } from '../config.js';
import { debug } from '../log.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}\.md$/;

export function collectJournalEntries(): string | null {
  debug('Collecting journal entries from remotes...');

  if (!existsSync(REMOTES_DIR)) return null;

  let totalEntries = 0;

  for (const host of readdirSync(REMOTES_DIR)) {
    const journalDir = resolve(REMOTES_DIR, host, 'discord-kb', 'journal');
    if (!existsSync(journalDir)) continue;

    // Each host gets its own subdirectory under journal/
    const hostJournalDir = resolve(MERGED_DIR, 'discord-kb', 'journal', host);
    mkdirSync(hostJournalDir, { recursive: true });

    for (const file of readdirSync(journalDir)) {
      if (!DATE_PATTERN.test(file)) continue;
      copyFileSync(resolve(journalDir, file), resolve(hostJournalDir, file));
      totalEntries++;
    }
  }

  if (totalEntries === 0) {
    debug('No journal entries found in remotes');
    return null;
  }

  debug(`Collected ${totalEntries} journal entries into per-host directories`);
  return `${totalEntries} journal entries`;
}
