import { loadPermissions, loadEnabledPlugins, type ResolvedHost } from '../config.js';
import { readRemoteJson, writeRemoteJson } from '../ssh.js';
import { warn } from '../log.js';

export async function reconcileSettings(host: ResolvedHost): Promise<boolean> {
  const permissions = loadPermissions();
  const enabledPlugins = loadEnabledPlugins();

  const hasPermissions = permissions.length > 0;
  const hasPlugins = Object.keys(enabledPlugins).length > 0;

  if (!hasPermissions && !hasPlugins) return false;

  try {
    const settings = await readRemoteJson(host, '~/.claude/settings.json');
    const before = JSON.stringify(settings);

    if (hasPermissions) {
      const existing = settings.permissions as Record<string, unknown> | undefined;
      settings.permissions = {
        ...existing,
        allow: permissions,
      };
    }

    if (hasPlugins) {
      const existing = (settings.enabledPlugins as Record<string, boolean>) ?? {};
      settings.enabledPlugins = { ...existing, ...enabledPlugins };
    }

    // Only write if settings actually changed
    if (JSON.stringify(settings) === before) return false;

    await writeRemoteJson(host, '~/.claude/settings.json', settings);
    return true;
  } catch (e) {
    warn(`  Settings sync failed for ${host.name}: ${(e as Error).message}`);
    throw e;
  }
}
