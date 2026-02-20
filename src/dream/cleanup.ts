import { existsSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { MERGED_DIR, DREAM_LOG_DIR } from '../config.js';
import { info, success } from '../log.js';

const RETENTION_WEEKS = 4;

export function cleanup(): void {
  info('Enforcing retention policy...');

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_WEEKS * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let deleted = 0;

  // Clean journal entries
  const journalDir = resolve(MERGED_DIR, 'discord-kb', 'journal');
  if (existsSync(journalDir)) {
    for (const file of readdirSync(journalDir)) {
      const datePart = file.replace('.md', '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < cutoffStr) {
        info(`  Deleting old journal entry: ${file}`);
        unlinkSync(resolve(journalDir, file));
        deleted++;
      }
    }
  }

  // Clean dream logs
  if (existsSync(DREAM_LOG_DIR)) {
    for (const file of readdirSync(DREAM_LOG_DIR)) {
      const datePart = file.replace('.md', '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < cutoffStr) {
        info(`  Deleting old dream log: ${file}`);
        unlinkSync(resolve(DREAM_LOG_DIR, file));
        deleted++;
      }
    }
  }

  if (deleted > 0) {
    success(`Cleaned up ${deleted} old files`);
  } else {
    info('No old files to clean up');
  }
}
