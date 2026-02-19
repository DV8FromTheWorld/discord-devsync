import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, loadPermissions, savePermissions } from '../config.js';
import { info, success } from '../log.js';

export function mergePermissions(): void {
  info('Starting permissions merge...', 'permissions-merge');

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
    info('  No permissions found. Skipping.', 'permissions-merge');
    return;
  }

  savePermissions([...all]);
  success(`  Permissions merge complete (${all.size} rules)`, 'permissions-merge');
}
