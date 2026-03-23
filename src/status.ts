import { execFileSync } from 'child_process';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  DATA_DIR,
  CONFIG_PATH,
  MERGED_DIR,
  REMOTES_DIR,
  DOTFILES_DIR,
  SECRETS_DIR,
  DREAM_LOG_DIR,
  MCP_SERVERS_PATH,
  PERMISSIONS_PATH,
  PLUGINS_ENABLED_PATH,
  PLUGINS_INSTALLED_PATH,
  loadConfig,
  loadMcpServers,
  loadPermissions,
  loadEnabledPlugins,
  loadInstalledPlugins,
  resolveAllHosts,
} from './config.js';

const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';

function heading(text: string): void {
  console.log(`\n${BOLD}${text}${RESET}`);
}

function kv(key: string, value: string | number, indent = 2): void {
  const pad = ' '.repeat(indent);
  console.log(`${pad}${DIM}${key}:${RESET} ${value}`);
}

function countFiles(dir: string, ext?: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  function walk(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (!ext || entry.name.endsWith(ext)) count++;
    }
  }
  walk(dir);
  return count;
}

function countDirs(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
}

function gitInfo(cwd: string): { isRepo: boolean; lastCommit?: string; branch?: string; dirty?: boolean } {
  try {
    execFileSync('git', ['rev-parse', '--git-dir'], { cwd, stdio: 'pipe' });
  } catch {
    return { isRepo: false };
  }

  let lastCommit: string | undefined;
  try {
    lastCommit = execFileSync('git', ['log', '-1', '--format=%ar — %s'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    // no commits yet
  }

  let branch: string | undefined;
  try {
    branch = execFileSync('git', ['branch', '--show-current'], {
      cwd,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
  } catch {
    // detached HEAD or similar
  }

  let dirty = false;
  try {
    execFileSync('git', ['diff', '--quiet', 'HEAD'], { cwd, stdio: 'pipe' });
  } catch {
    dirty = true;
  }

  return { isRepo: true, lastCommit, branch, dirty };
}

export function showStatus(): void {
  // --- Paths ---
  heading('Data Directory');
  kv('path', DATA_DIR);
  kv('config', CONFIG_PATH);

  const git = gitInfo(DATA_DIR);
  if (git.isRepo) {
    kv('git branch', git.branch || '(detached)');
    if (git.lastCommit) {
      kv('last commit', git.lastCommit);
    }
    if (git.dirty) {
      kv('working tree', `${YELLOW}dirty${RESET}`);
    } else {
      kv('working tree', 'clean');
    }
  } else {
    kv('git', 'not a git repo');
  }

  // --- Config ---
  const config = loadConfig();

  // --- Hosts ---
  const hostEntries = Object.entries(config.hosts);
  heading(`Hosts (${hostEntries.length})`);
  const resolved = resolveAllHosts(config);
  for (const host of resolved) {
    const locality = host.isLocal ? `${DIM}(local)${RESET}` : `${DIM}(${host.hostname})${RESET}`;
    const layers = host.isLocal
      ? config.hosts[host.name].layers.join(', ')
      : config.hosts[host.name].layers.join(', ');
    console.log(`  ${BOLD}${host.name}${RESET} ${locality}`);
    kv('platform', host.platform, 4);
    kv('layers', layers, 4);
  }

  // --- Layers ---
  const layerEntries = Object.entries(config.layers);
  heading(`Layers (${layerEntries.length})`);
  for (const [name, layer] of layerEntries) {
    const desc = layer.description ? ` ${DIM}— ${layer.description}${RESET}` : '';
    console.log(`  ${BOLD}${name}${RESET}${desc}`);
  }

  // --- Content (merged) ---
  heading('Merged Content');

  const claudePath = resolve(MERGED_DIR, 'CLAUDE.md');
  if (existsSync(claudePath)) {
    const lines = readFileSync(claudePath, 'utf-8').split('\n').length;
    kv('CLAUDE.md', `${GREEN}✓${RESET} ${lines} lines`);
  } else {
    kv('CLAUDE.md', '—');
  }

  const kbDir = resolve(MERGED_DIR, 'discord-kb');
  if (existsSync(kbDir)) {
    const mdCount = countFiles(kbDir, '.md');
    kv('KB', `${GREEN}✓${RESET} ${mdCount} files`);
  } else {
    kv('KB', '—');
  }

  const skillsDir = resolve(MERGED_DIR, '.claude', 'skills');
  if (existsSync(skillsDir)) {
    kv('skills', `${GREEN}✓${RESET} ${countDirs(skillsDir)} skills`);
  } else {
    kv('skills', '—');
  }

  const agentsDir = resolve(MERGED_DIR, '.claude', 'agents');
  if (existsSync(agentsDir)) {
    const agents = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
    kv('agents', `${GREEN}✓${RESET} ${agents.length} agents`);
  } else {
    kv('agents', '—');
  }

  const mcpServers = loadMcpServers();
  const mcpCount = Object.keys(mcpServers).length;
  kv('MCP servers', mcpCount > 0 ? `${GREEN}✓${RESET} ${mcpCount} servers` : '—');

  const permissions = loadPermissions();
  kv('permissions', permissions.length > 0 ? `${GREEN}✓${RESET} ${permissions.length} rules` : '—');

  const enabledPlugins = loadEnabledPlugins();
  const enabledCount = Object.values(enabledPlugins).filter(Boolean).length;
  const installedPlugins = loadInstalledPlugins();
  const installedCount = Object.keys(installedPlugins.plugins).length;
  if (installedCount > 0) {
    kv('plugins', `${GREEN}✓${RESET} ${installedCount} installed, ${enabledCount} enabled`);
  } else {
    kv('plugins', '—');
  }

  if (existsSync(DOTFILES_DIR)) {
    const count = countFiles(DOTFILES_DIR);
    kv('dotfiles', count > 0 ? `${GREEN}✓${RESET} ${count} files` : '—');
  } else {
    kv('dotfiles', '—');
  }

  const secretsEnv = resolve(SECRETS_DIR, 'env');
  if (existsSync(secretsEnv)) {
    const lines = readFileSync(secretsEnv, 'utf-8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).length;
    kv('secrets', `${GREEN}✓${RESET} ${lines} variables`);
  } else {
    kv('secrets', '—');
  }

  // --- Remotes (last fetch) ---
  if (existsSync(REMOTES_DIR)) {
    const remoteHosts = readdirSync(REMOTES_DIR, { withFileTypes: true }).filter((e) => e.isDirectory());
    if (remoteHosts.length > 0) {
      heading(`Remotes Cache (${remoteHosts.length} hosts)`);
      for (const entry of remoteHosts) {
        const hostDir = resolve(REMOTES_DIR, entry.name);
        const lastFetchFile = resolve(hostDir, '.last-fetch');
        if (existsSync(lastFetchFile)) {
          const ts = readFileSync(lastFetchFile, 'utf-8').trim();
          const age = timeSince(new Date(ts).getTime());
          console.log(`  ${entry.name} ${DIM}(fetched ${age} ago)${RESET}`);
        } else {
          console.log(`  ${entry.name} ${DIM}(never fetched)${RESET}`);
        }
      }
    }
  }

  // --- Dream log ---
  if (existsSync(DREAM_LOG_DIR)) {
    const logs = readdirSync(DREAM_LOG_DIR).filter((f) => f.endsWith('.md'));
    if (logs.length > 0) {
      heading('Dream Log');
      kv('entries', `${logs.length} logs`);
      const latest = logs.sort().at(-1);
      if (latest) kv('latest', latest.replace('.md', ''));
    }
  }

  console.log();
}

function timeSince(timestampMs: number): string {
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
