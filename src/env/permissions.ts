import { loadPermissions, type ResolvedHost } from '../config.js';
import { readRemoteJson, writeRemoteJson } from '../ssh.js';
import { warn } from '../log.js';

export async function reconcilePermissions(host: ResolvedHost): Promise<boolean> {
  const permissions = loadPermissions();
  if (permissions.length === 0) return false;

  try {
    const settings = await readRemoteJson(host, '~/.claude/settings.json');

    const existing = settings.permissions as Record<string, unknown> | undefined;
    settings.permissions = {
      ...existing,
      allow: permissions,
    };

    await writeRemoteJson(host, '~/.claude/settings.json', settings);
    return true;
  } catch (e) {
    warn(`  Permissions sync failed for ${host.name}: ${(e as Error).message}`);
    throw e;
  }
}
