import { existsSync, readFileSync, readdirSync, cpSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import {
  REMOTES_DIR,
  PLUGINS_CACHE_DIR,
  loadEnabledPlugins,
  saveEnabledPlugins,
  loadInstalledPlugins,
  saveInstalledPlugins,
  type InstalledPluginsFile,
  type PluginInstallEntry,
} from '../config.js';
import { debug } from '../log.js';
import { type ContentChange } from './changes.js';

export function mergePlugins(): ContentChange | null {
  debug('Starting plugins merge...');

  const parts: string[] = [];

  // --- Merge enabledPlugins ---
  const mergedEnabled: Record<string, boolean> = loadEnabledPlugins();
  const oldEnabledCount = Object.keys(mergedEnabled).length;

  if (existsSync(REMOTES_DIR)) {
    for (const host of readdirSync(REMOTES_DIR)) {
      const enabledFile = resolve(REMOTES_DIR, host, 'plugins-enabled.json');
      if (!existsSync(enabledFile)) continue;

      try {
        const raw = readFileSync(enabledFile, 'utf-8');
        const hostEnabled = JSON.parse(raw) as Record<string, boolean>;
        for (const [key, value] of Object.entries(hostEnabled)) {
          if (typeof value !== 'boolean') continue;
          // If any host has it true, include as true
          if (value === true) {
            mergedEnabled[key] = true;
          } else if (!(key in mergedEnabled)) {
            // Only set false if not already present
            mergedEnabled[key] = false;
          }
        }
      } catch {
        // Skip invalid files
      }
    }
  }

  const enabledCount = Object.keys(mergedEnabled).length;
  if (enabledCount > 0) {
    saveEnabledPlugins(mergedEnabled);
  }
  const newEnabled = enabledCount - oldEnabledCount;
  if (newEnabled > 0) {
    parts.push(`+${newEnabled} enabled plugins`);
  }

  // --- Merge installed_plugins.json ---
  const mergedInstalled: InstalledPluginsFile = loadInstalledPlugins();
  const oldInstalledCount = Object.keys(mergedInstalled.plugins).length;

  if (existsSync(REMOTES_DIR)) {
    for (const host of readdirSync(REMOTES_DIR)) {
      const installedFile = resolve(REMOTES_DIR, host, 'installed-plugins.json');
      if (!existsSync(installedFile)) continue;

      try {
        const raw = readFileSync(installedFile, 'utf-8');
        const hostData = JSON.parse(raw) as InstalledPluginsFile;
        if (!hostData.plugins || typeof hostData.plugins !== 'object') continue;

        for (const [pluginKey, entries] of Object.entries(hostData.plugins)) {
          if (!Array.isArray(entries)) continue;

          for (const entry of entries) {
            if (entry.scope !== 'user') continue;

            // Normalize installPath to canonical form for storage
            const normalized: PluginInstallEntry = {
              ...entry,
              installPath: canonicalInstallPath(entry.installPath),
            };

            // Find existing entry for this plugin key + scope
            if (!mergedInstalled.plugins[pluginKey]) {
              mergedInstalled.plugins[pluginKey] = [normalized];
              continue;
            }

            const existingIdx = mergedInstalled.plugins[pluginKey].findIndex(
              (e) => e.scope === 'user',
            );
            if (existingIdx === -1) {
              mergedInstalled.plugins[pluginKey].push(normalized);
            } else {
              // Keep the one with the newest lastUpdated
              const existing = mergedInstalled.plugins[pluginKey][existingIdx];
              if (normalized.lastUpdated > existing.lastUpdated) {
                mergedInstalled.plugins[pluginKey][existingIdx] = normalized;
              }
            }
          }
        }
      } catch {
        // Skip invalid files
      }
    }
  }

  const pluginCount = Object.keys(mergedInstalled.plugins).length;
  if (pluginCount > 0) {
    saveInstalledPlugins(mergedInstalled);
  }
  const newInstalled = pluginCount - oldInstalledCount;
  if (newInstalled > 0) {
    parts.push(`+${newInstalled} installed plugins`);
  }

  // --- Merge cache directories ---
  let cacheCount = 0;

  if (existsSync(REMOTES_DIR)) {
    for (const host of readdirSync(REMOTES_DIR)) {
      const hostCache = resolve(REMOTES_DIR, host, '.claude', 'plugins', 'cache');
      if (!existsSync(hostCache)) continue;

      mkdirSync(PLUGINS_CACHE_DIR, { recursive: true });
      cpSync(hostCache, PLUGINS_CACHE_DIR, { recursive: true });
      cacheCount++;
    }
  }

  // Cache is always copied — don't report unless there are other changes

  if (parts.length === 0) {
    debug('  No plugins found. Skipping.');
    return null;
  }

  return { label: 'plugins', summary: parts.join(', ') };
}

/** Normalize an absolute installPath to a canonical ~/.claude/plugins/cache/... form. */
function canonicalInstallPath(path: string): string {
  const marker = '/.claude/plugins/cache/';
  const idx = path.indexOf(marker);
  if (idx !== -1) {
    return '~/.claude/plugins/cache/' + path.slice(idx + marker.length);
  }
  return path;
}
