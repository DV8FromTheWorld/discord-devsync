import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { ConfigSchema, McpServersSchema, formatValidationErrors } from './schema.js';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = resolve(PROJECT_ROOT, 'data');
export const REMOTES_DIR = resolve(DATA_DIR, 'remotes');
export const MERGED_DIR = resolve(DATA_DIR, 'merged');
export const DREAM_LOG_DIR = resolve(DATA_DIR, 'dream_log');
export const DOTFILES_DIR = resolve(DATA_DIR, 'dotfiles');
export const SECRETS_DIR = resolve(DATA_DIR, 'secrets');

export const CONFIG_PATH = resolve(DATA_DIR, 'config.yaml');
export const MCP_SERVERS_PATH = resolve(MERGED_DIR, 'mcp-servers.json');
export const PERMISSIONS_PATH = resolve(MERGED_DIR, 'permissions.json');

export type Platform = 'darwin' | 'linux';

export interface Paths {
  claude_md: string;
  kb: string;
  skills: string;
}

export interface Layer {
  description?: string;
  skills?: string[] | 'all';
  mcp?: string[];
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

export interface StdioMcpServer {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export type McpServer = HttpMcpServer | StdioMcpServer;

export interface PlatformDefaults {
  paths: Paths;
}

export interface Config {
  defaults: Record<Platform, PlatformDefaults>;
  layers: Record<string, Layer>;
  hosts: Record<string, HostConfig>;
}

export function configExists(): boolean {
  return existsSync(CONFIG_PATH);
}

export function loadConfig(): Config {
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
      `Invalid mcp-servers.json:\n${formatValidationErrors(result.error)}\n\nFix the issues above in data/merged/mcp-servers.json.`,
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
  mcp: Set<string>;
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
  const mcp = new Set<string>();
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

    if (layer.mcp) {
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
    mcp,
    dotfiles,
    secrets,
    isLocal: host.hostname === 'localhost',
  };
}

export function resolveAllHosts(config: Config): ResolvedHost[] {
  return Object.keys(config.hosts).map((name) => resolveHost(config, name));
}
