import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, MERGED_DIR } from '../config.js';
import { debug } from '../log.js';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}\.md$/;

export function collectJournalEntries(): string | null {
  debug('Collecting journal entries from remotes...');

  if (!existsSync(REMOTES_DIR)) return null;

  let totalFiles = 0;
  let hostCount = 0;

  for (const host of readdirSync(REMOTES_DIR)) {
    const journalDir = resolve(REMOTES_DIR, host, 'discord-kb', 'journal');
    if (!existsSync(journalDir)) continue;

    const files = readdirSync(journalDir).filter((f) => DATE_PATTERN.test(f));
    if (files.length === 0) continue;

    const hostJournalDir = resolve(MERGED_DIR, 'discord-kb', 'journal', host);
    mkdirSync(hostJournalDir, { recursive: true });

    for (const file of files) {
      copyFileSync(resolve(journalDir, file), resolve(hostJournalDir, file));
    }

    debug(`  ${host}: ${files.length} journal entries`);
    totalFiles += files.length;
    hostCount++;
  }

  if (totalFiles === 0) {
    debug('No journal entries found in remotes');
    return null;
  }

  return `${totalFiles} journal entries from ${hostCount} hosts`;
}
