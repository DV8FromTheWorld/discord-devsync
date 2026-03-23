import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, loadPermissions, savePermissions } from '../config.js';
import { debug } from '../log.js';
import { type ContentChange } from './changes.js';

export function mergePermissions(): ContentChange | null {
  debug('Starting permissions merge...');

  const existing = loadPermissions();
  const all = new Set<string>(existing);

  if (existsSync(REMOTES_DIR)) {
    for (const host of readdirSync(REMOTES_DIR)) {
      const permFile = resolve(REMOTES_DIR, host, 'permissions.json');
      if (!existsSync(permFile)) continue;

      try {
        const raw = readFileSync(permFile, 'utf-8');
        const permissions = JSON.parse(raw);
        if (Array.isArray(permissions)) {
          for (const p of permissions) {
            if (typeof p === 'string') all.add(p);
          }
        }
      } catch {
        // Skip invalid files
      }
    }
  }

  if (all.size === 0) {
    debug('  No permissions found. Skipping.');
    return null;
  }

  savePermissions([...all]);

  const newCount = all.size - existing.length;
  if (newCount <= 0) return null;

  return { label: 'permissions', summary: `+${newCount} rules` };
}
