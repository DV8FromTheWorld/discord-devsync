import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import {
  REMOTES_DIR,
  loadMcpServers,
  saveMcpServers,
  type McpServer,
} from '../config.js';
import { info, success, warn } from '../log.js';

interface RemoteMcpData {
  host: string;
  servers: Record<string, McpServer>;
}

function loadRemoteMcpFiles(): RemoteMcpData[] {
  const results: RemoteMcpData[] = [];
  if (!existsSync(REMOTES_DIR)) return results;

  for (const host of readdirSync(REMOTES_DIR)) {
    const mcpFile = resolve(REMOTES_DIR, host, 'mcp-servers.json');
    if (!existsSync(mcpFile)) continue;

    try {
      const raw = readFileSync(mcpFile, 'utf-8');
      const servers = JSON.parse(raw) as Record<string, McpServer>;
      if (Object.keys(servers).length > 0) {
        results.push({ host, servers });
      }
    } catch {
      warn(`  Skipping invalid MCP file from ${host}`, 'mcp-merge');
    }
  }

  return results;
}

export function mergeMcpServers(): void {
  info('Starting MCP server merge...', 'mcp-merge');

  const remoteSources = loadRemoteMcpFiles();
  const existingMerged = loadMcpServers();

  if (remoteSources.length === 0 && Object.keys(existingMerged).length === 0) {
    info('  No MCP server configs found. Skipping.', 'mcp-merge');
    return;
  }

  // Union: start with existing merged state, overlay remote sources
  const merged: Record<string, McpServer> = { ...existingMerged };

  // Collect all server names across all remotes
  const remoteServerNames = new Set<string>();
  for (const source of remoteSources) {
    for (const name of Object.keys(source.servers)) {
      remoteServerNames.add(name);
    }
  }

  if (remoteServerNames.size > 0) {
    info(`  Found ${remoteServerNames.size} MCP server(s) across ${remoteSources.length} host(s)`, 'mcp-merge');
  }

  for (const serverName of remoteServerNames) {
    const sources = remoteSources.filter((r) => serverName in r.servers);

    if (sources.length === 1) {
      // Single source — use it (overrides merged if different)
      merged[serverName] = sources[0].servers[serverName];
    } else {
      // Multiple sources — check if identical
      const configs = sources.map((s) => JSON.stringify(s.servers[serverName]));
      const allSame = configs.every((c) => c === configs[0]);

      if (allSame) {
        merged[serverName] = sources[0].servers[serverName];
      } else {
        // Conflict: keep existing merged version if present, otherwise use first source
        const hosts = sources.map((s) => s.host).join(', ');
        if (serverName in existingMerged) {
          warn(`  Server '${serverName}' differs across hosts (${hosts}) — keeping existing merged config`, 'mcp-merge');
        } else {
          warn(`  Server '${serverName}' differs across hosts (${hosts}) — using config from ${sources[0].host}`, 'mcp-merge');
          merged[serverName] = sources[0].servers[serverName];
        }
      }
    }
  }

  saveMcpServers(merged);
  success(`  MCP merge complete (${Object.keys(merged).length} servers)`, 'mcp-merge');
}
