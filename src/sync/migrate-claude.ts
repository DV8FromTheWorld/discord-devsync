import { existsSync, unlinkSync, readdirSync, renameSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, MERGED_DIR, DATA_DIR } from '../config.js';
import { info, debug } from '../log.js';

const MIGRATION_MARKER = resolve(DATA_DIR, '.migrated-claude-split');

/**
 * One-time migration from single CLAUDE.md to user-CLAUDE.md + CLAUDE.local.md layout.
 *
 * 1. Renames merged/CLAUDE.md → merged/CLAUDE.local.md (preserves personal project content)
 * 2. Deletes remotes/{host}/CLAUDE.md for all hosts (stale — fetch paths are changing)
 * 3. Writes a marker file so this only runs once
 */
export function migrateFromSingleClaudeMd(): void {
  if (existsSync(MIGRATION_MARKER)) return;

  let migrated = false;

  // Rename merged/CLAUDE.md → merged/CLAUDE.local.md
  const oldMerged = resolve(MERGED_DIR, 'CLAUDE.md');
  if (existsSync(oldMerged)) {
    renameSync(oldMerged, resolve(MERGED_DIR, 'CLAUDE.local.md'));
    info('Migration: renamed merged/CLAUDE.md → merged/CLAUDE.local.md');
    migrated = true;
  }

  // Delete stale remotes/{host}/CLAUDE.md
  if (existsSync(REMOTES_DIR)) {
    for (const host of readdirSync(REMOTES_DIR)) {
      const oldRemote = resolve(REMOTES_DIR, host, 'CLAUDE.md');
      if (existsSync(oldRemote)) {
        unlinkSync(oldRemote);
        debug(`Migration: removed stale remotes/${host}/CLAUDE.md`);
        migrated = true;
      }
    }
  }

  writeFileSync(MIGRATION_MARKER, new Date().toISOString() + '\n');

  if (migrated) {
    info('Migrated to user-CLAUDE.md + CLAUDE.local.md layout.');
    info('Run "devsync sync pull" to fetch the new files from your hosts.');
  }
}
