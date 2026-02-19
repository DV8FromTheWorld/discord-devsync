import { existsSync } from 'fs';
import { REMOTES_DIR, MERGED_DIR } from '../config.js';
import { info, success, error } from '../log.js';
import { mergeClaudeMd } from './merge-claude.js';
import { mergeKbDirectories } from './merge-kb.js';
import { mergeSkillsDirectories } from './merge-skills.js';
import { collectJournalEntries } from './collect-journal.js';

export function merge(): void {
  info('Starting merge...', 'sync');

  if (!existsSync(REMOTES_DIR)) {
    error("No remotes/ directory found. Run 'fetch' first.", 'sync');
    process.exit(1);
  }

  mergeClaudeMd();
  mergeKbDirectories();
  collectJournalEntries();
  mergeSkillsDirectories();

  success('Merge completed', 'sync');
}
