import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ConfigSchema, McpServersSchema, formatValidationErrors } from './schema.js';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DEVSYNC_CONFIG_DIR = resolve(homedir(), '.config', 'devsync');
export const DATA_DIR_FILE = resolve(DEVSYNC_CONFIG_DIR, 'data-dir');

function resolveDataDir(): string {
  if (existsSync(DATA_DIR_FILE)) {
    return readFileSync(DATA_DIR_FILE, 'utf-8').trim();
  }
  // Default location — init will create this and write the pointer file
  return resolve(DEVSYNC_CONFIG_DIR, 'data');
}

export const DATA_DIR = resolveDataDir();
export const REMOTES_DIR = resolve(DATA_DIR, 'remotes');
export const MERGED_DIR = resolve(DATA_DIR, 'merged');
export const DREAM_LOG_DIR = resolve(DATA_DIR, 'dream_log');
export const DOTFILES_DIR = resolve(DATA_DIR, 'dotfiles');
export const SECRETS_DIR = resolve(DATA_DIR, 'secrets');

export const CONFIG_PATH = resolve(DATA_DIR, 'config.yaml');
export const MCP_SERVERS_PATH = resolve(MERGED_DIR, 'mcp-servers.json');
export const MCP_EXCLUDE_PATH = resolve(MERGED_DIR, 'mcp-exclude.json');
export const PERMISSIONS_PATH = resolve(MERGED_DIR, 'permissions.json');
export const PLUGINS_ENABLED_PATH = resolve(MERGED_DIR, 'plugins-enabled.json');
export const PLUGINS_INSTALLED_PATH = resolve(MERGED_DIR, 'installed-plugins.json');
export const PLUGINS_CACHE_DIR = resolve(MERGED_DIR, '.claude', 'plugins', 'cache');

export type Platform = 'darwin' | 'linux';

export interface Paths {
  claude_md: string;
  kb: string;
  skills: string;
}

export interface Layer {
  description?: string;
  skills?: string[] | 'all';
  agents?: string[] | 'all';
  mcp?: string[] | 'all';
  dotfiles?: boolean;
  secrets?: boolean;
}

export interface HostConfig {
  hostname: string;
  platform: Platform;
  layers: string[];
  paths?: Partial<Paths>;
}

export interface HttpMcpServer {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface SseMcpServer {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export interface StdioMcpServer {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type McpServer = HttpMcpServer | SseMcpServer | StdioMcpServer;

export interface PlatformDefaults {
  paths: Paths;
}

export interface Config {
  defaults: Record<Platform, PlatformDefaults>;
  layers: Record<string, Layer>;
  hosts: Record<string, HostConfig>;
}

export function configExists(): boolean {
  return existsSync(DATA_DIR) && existsSync(CONFIG_PATH);
}

export function loadConfig(): Config {
  if (!existsSync(DATA_DIR)) {
    throw new Error(
      `Data directory not found at ${DATA_DIR}.\nRun 'devsync init' to reconfigure, or check that the path is accessible.`,
    );
  }
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Config not found. Run 'devsync init' first.`);
  }
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = parseYaml(raw);

  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid config.yaml:\n${formatValidationErrors(result.error)}\n\nFix the issues above or run 'devsync init' to regenerate.`,
    );
  }

  return result.data as Config;
}

export function saveConfig(config: Config): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, stringifyYaml(config, { lineWidth: 120 }));
}

export function loadMcpServers(): Record<string, McpServer> {
  if (!existsSync(MCP_SERVERS_PATH)) {
    return {};
  }
  const raw = readFileSync(MCP_SERVERS_PATH, 'utf-8');
  const parsed = JSON.parse(raw);

  const result = McpServersSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Invalid mcp-servers.json:\n${formatValidationErrors(result.error)}\n\nFix the issues above in ${MCP_SERVERS_PATH}.`,
    );
  }

  return result.data as Record<string, McpServer>;
}

export function saveMcpServers(servers: Record<string, McpServer>): void {
  mkdirSync(MERGED_DIR, { recursive: true });
  writeFileSync(MCP_SERVERS_PATH, JSON.stringify(servers, null, 2) + '\n');
}

export function loadPermissions(): string[] {
  if (!existsSync(PERMISSIONS_PATH)) {
    return [];
  }
  const raw = readFileSync(PERMISSIONS_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((p: unknown) => typeof p === 'string');
}

export function savePermissions(permissions: string[]): void {
  mkdirSync(MERGED_DIR, { recursive: true });
  const sorted = [...new Set(permissions)].sort();
  writeFileSync(PERMISSIONS_PATH, JSON.stringify(sorted, null, 2) + '\n');
}

export function loadMcpExclude(): string[] {
  if (!existsSync(MCP_EXCLUDE_PATH)) return [];
  try {
    const raw = readFileSync(MCP_EXCLUDE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p: unknown) => typeof p === 'string');
  } catch {
    return [];
  }
}

export function saveMcpExclude(names: string[]): void {
  mkdirSync(MERGED_DIR, { recursive: true });
  const sorted = [...new Set(names)].sort();
  writeFileSync(MCP_EXCLUDE_PATH, JSON.stringify(sorted, null, 2) + '\n');
}

export interface PluginInstallEntry {
  scope: string;
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
  gitCommitSha: string;
}

export interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, PluginInstallEntry[]>;
}

export function loadEnabledPlugins(): Record<string, boolean> {
  if (!existsSync(PLUGINS_ENABLED_PATH)) return {};
  try {
    const raw = readFileSync(PLUGINS_ENABLED_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function saveEnabledPlugins(plugins: Record<string, boolean>): void {
  mkdirSync(MERGED_DIR, { recursive: true });
  const sorted = Object.fromEntries(Object.entries(plugins).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(PLUGINS_ENABLED_PATH, JSON.stringify(sorted, null, 2) + '\n');
}

export function loadInstalledPlugins(): InstalledPluginsFile {
  if (!existsSync(PLUGINS_INSTALLED_PATH)) return { version: 1, plugins: {} };
  try {
    const raw = readFileSync(PLUGINS_INSTALLED_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { version: 1, plugins: {} };
    return parsed as InstalledPluginsFile;
  } catch {
    return { version: 1, plugins: {} };
  }
}

export function saveInstalledPlugins(data: InstalledPluginsFile): void {
  mkdirSync(MERGED_DIR, { recursive: true });
  writeFileSync(PLUGINS_INSTALLED_PATH, JSON.stringify(data, null, 2) + '\n');
}

export function getHostPaths(config: Config, host: HostConfig): Paths {
  const platformDefaults = config.defaults[host.platform]?.paths ?? config.defaults.linux?.paths;
  return { ...platformDefaults, ...host.paths };
}

export interface ResolvedHost {
  name: string;
  hostname: string;
  platform: Platform;
  paths: Paths;
  skills: Set<string> | 'all';
  agents: Set<string> | 'all';
  mcp: Set<string> | 'all';
  dotfiles: boolean;
  secrets: boolean;
  isLocal: boolean;
}

export function resolveHost(config: Config, hostName: string): ResolvedHost {
  const host = config.hosts[hostName];
  if (!host) {
    throw new Error(`Unknown host: ${hostName}`);
  }

  let skills: Set<string> | 'all' = new Set();
  let agents: Set<string> | 'all' = new Set();
  let mcp: Set<string> | 'all' = new Set();
  let dotfiles = false;
  let secrets = false;

  for (const layerName of host.layers) {
    const layer = config.layers[layerName];
    if (!layer) {
      throw new Error(`Unknown layer "${layerName}" referenced by host "${hostName}"`);
    }

    if (layer.skills === 'all') {
      skills = 'all';
    } else if (skills !== 'all' && layer.skills) {
      for (const s of layer.skills) skills.add(s);
    }

    if (layer.agents === 'all') {
      agents = 'all';
    } else if (agents !== 'all' && layer.agents) {
      for (const a of layer.agents) agents.add(a);
    }

    if (layer.mcp === 'all') {
      mcp = 'all';
    } else if (mcp !== 'all' && layer.mcp) {
      for (const m of layer.mcp) mcp.add(m);
    }

    if (layer.dotfiles) dotfiles = true;
    if (layer.secrets) secrets = true;
  }

  return {
    name: hostName,
    hostname: host.hostname,
    platform: host.platform,
    paths: getHostPaths(config, host),
    skills,
    agents,
    mcp,
    dotfiles,
    secrets,
    isLocal: host.hostname === 'localhost',
  };
}

export function resolveAllHosts(config: Config): ResolvedHost[] {
  return Object.keys(config.hosts).map((name) => resolveHost(config, name));
}
