import { existsSync } from 'fs';
import { PLUGINS_CACHE_DIR, loadInstalledPlugins, type ResolvedHost } from '../config.js';
import { rsync, remotePath, hostExec, writeRemoteJson } from '../ssh.js';
import { warn } from '../log.js';
import { parseRsyncItemize } from '../sync/changes.js';

export async function reconcilePlugins(host: ResolvedHost): Promise<boolean> {
  let pushed = false;

  // 1. Push plugin cache via rsync
  if (existsSync(PLUGINS_CACHE_DIR)) {
    const r = await rsync(PLUGINS_CACHE_DIR + '/', remotePath(host, '~/.claude/plugins/cache/'));
    if (r.ok) {
      const changes = parseRsyncItemize(r.stdout);
      if (changes.length > 0) pushed = true;
    }
  }

  // 2. Write installed_plugins.json with rewritten installPaths
  const installed = loadInstalledPlugins();
  if (Object.keys(installed.plugins).length > 0) {
    try {
      // Get remote home directory
      const homeResult = await hostExec(host, 'echo $HOME');
      const remoteHome = homeResult.ok ? homeResult.stdout.trim() : '/root';

      // Rewrite installPaths to use the remote's absolute home dir
      const rewritten = {
        ...installed,
        plugins: Object.fromEntries(
          Object.entries(installed.plugins).map(([key, entries]) => [
            key,
            entries.map((entry) => ({
              ...entry,
              installPath: expandInstallPath(entry.installPath, remoteHome),
            })),
          ]),
        ),
      };

      await writeRemoteJson(
        host,
        '~/.claude/plugins/installed_plugins.json',
        rewritten as unknown as Record<string, unknown>,
      );
      // Metadata is always written — only count as "pushed" if cache files changed
    } catch (e) {
      warn(`  Plugin metadata sync failed for ${host.name}: ${(e as Error).message}`);
    }
  }

  return pushed;
}

/** Expand a canonical ~/... installPath to an absolute path using the remote home directory. */
function expandInstallPath(path: string, remoteHome: string): string {
  if (path.startsWith('~/')) {
    return remoteHome + path.slice(1);
  }
  return path;
}
