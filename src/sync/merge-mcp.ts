import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import {
  REMOTES_DIR,
  loadMcpServers,
  saveMcpServers,
  loadMcpExclude,
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
  const excluded = new Set(loadMcpExclude());

  if (remoteSources.length === 0 && Object.keys(existingMerged).length === 0) {
    info('  No MCP server configs found. Skipping.', 'mcp-merge');
    return;
  }

  // Start with existing merged state
  const merged: Record<string, McpServer> = { ...existingMerged };
  const discovered: { name: string; host: string; server: McpServer }[] = [];

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
    // Skip excluded servers
    if (excluded.has(serverName)) continue;

    const sources = remoteSources.filter((r) => serverName in r.servers);
    const isKnown = serverName in existingMerged;

    if (isKnown) {
      // Known server — auto-merge (update config if changed)
      if (sources.length === 1) {
        merged[serverName] = sources[0].servers[serverName];
      } else {
        const configs = sources.map((s) => JSON.stringify(s.servers[serverName]));
        const allSame = configs.every((c) => c === configs[0]);
        if (allSame) {
          merged[serverName] = sources[0].servers[serverName];
        } else {
          // Conflict on known server — keep existing merged config
          const hosts = sources.map((s) => s.host).join(', ');
          warn(`  Server '${serverName}' differs across hosts (${hosts}) — keeping existing config`, 'mcp-merge');
        }
      }
    } else {
      // New server — flag for review, don't auto-merge
      discovered.push({
        name: serverName,
        host: sources[0].host,
        server: sources[0].servers[serverName],
      });
    }
  }

  saveMcpServers(merged);

  if (discovered.length > 0) {
    console.log();
    warn(`  ${discovered.length} new MCP server(s) discovered on remotes:`, 'mcp-merge');
    for (const d of discovered) {
      const type = d.server.type;
      const detail = type === 'http' ? d.server.url : d.server.command;
      console.log(`    - ${d.name} (${type}: ${detail}) from ${d.host}`);
    }
    console.log();
    info(`  Run 'devsync mcp review' to import or exclude them.`, 'mcp-merge');
  }

  success(`  MCP merge complete (${Object.keys(merged).length} servers${discovered.length > 0 ? `, ${discovered.length} pending review` : ''})`, 'mcp-merge');
}
