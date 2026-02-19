import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const REMOTES_DIR = resolve(PROJECT_ROOT, 'remotes');
export const MERGED_DIR = resolve(PROJECT_ROOT, 'merged');
export const DREAM_LOG_DIR = resolve(PROJECT_ROOT, 'dream_log');
export const DOTFILES_DIR = resolve(PROJECT_ROOT, 'dotfiles');
export const SECRETS_DIR = resolve(PROJECT_ROOT, 'secrets');

const CONFIG_PATH = resolve(PROJECT_ROOT, 'config.yaml');
const MCP_CONFIG_PATH = resolve(PROJECT_ROOT, 'mcp-servers.yaml');

export type Platform = 'darwin' | 'linux';

export interface Paths {
  claude_md: string;
  kb: string;
  skills: string;
  home: string;
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

export interface McpServer {
  transport: 'http' | 'stdio';
  url?: string;
  headers?: Record<string, string>;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface Config {
  defaults: { paths: Paths };
  layers: Record<string, Layer>;
  hosts: Record<string, HostConfig>;
}

export interface McpConfig {
  servers: Record<string, McpServer>;
}

export function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Config file not found: ${CONFIG_PATH}`);
  }
  const raw = readFileSync(CONFIG_PATH, 'utf-8');
  return parseYaml(raw) as Config;
}

export function loadMcpConfig(): McpConfig {
  if (!existsSync(MCP_CONFIG_PATH)) {
    return { servers: {} };
  }
  const raw = readFileSync(MCP_CONFIG_PATH, 'utf-8');
  return parseYaml(raw) as McpConfig;
}

export function getHostPaths(config: Config, host: HostConfig): Paths {
  return { ...config.defaults.paths, ...host.paths };
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
