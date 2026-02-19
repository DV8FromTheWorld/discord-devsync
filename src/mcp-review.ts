import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { select } from '@inquirer/prompts';
import {
  REMOTES_DIR,
  loadMcpServers,
  saveMcpServers,
  loadMcpExclude,
  saveMcpExclude,
  type McpServer,
} from './config.js';
import { info, success, warn } from './log.js';

interface DiscoveredServer {
  name: string;
  host: string;
  server: McpServer;
}

function findDiscoveredServers(): DiscoveredServer[] {
  const existing = loadMcpServers();
  const excluded = new Set(loadMcpExclude());
  const discovered: DiscoveredServer[] = [];

  if (!existsSync(REMOTES_DIR)) return discovered;

  const seen = new Set<string>();
  for (const host of readdirSync(REMOTES_DIR)) {
    const mcpFile = resolve(REMOTES_DIR, host, 'mcp-servers.json');
    if (!existsSync(mcpFile)) continue;

    try {
      const raw = readFileSync(mcpFile, 'utf-8');
      const servers = JSON.parse(raw) as Record<string, McpServer>;
      for (const [name, server] of Object.entries(servers)) {
        if (name in existing || excluded.has(name) || seen.has(name)) continue;
        seen.add(name);
        discovered.push({ name, host, server });
      }
    } catch {
      // Skip invalid files
    }
  }

  return discovered;
}

export async function mcpReview(): Promise<void> {
  const discovered = findDiscoveredServers();

  if (discovered.length === 0) {
    info('No new MCP servers to review. All servers are either imported or excluded.');
    return;
  }

  info(`${discovered.length} MCP server(s) to review:\n`);

  const servers = loadMcpServers();
  const excluded = loadMcpExclude();
  let imported = 0;
  let excludedCount = 0;

  for (const d of discovered) {
    const type = d.server.type;
    const detail = type === 'http' ? d.server.url : `${d.server.command} ${(d.server.args ?? []).join(' ')}`;

    console.log(`  ${d.name}`);
    console.log(`    type: ${type}`);
    console.log(`    ${type === 'http' ? 'url' : 'command'}: ${detail}`);
    console.log(`    found on: ${d.host}`);

    const action = await select<'import' | 'exclude' | 'skip'>({
      message: `What to do with '${d.name}'?`,
      choices: [
        { value: 'import', name: 'Import — add to devsync and sync to all hosts' },
        { value: 'exclude', name: 'Exclude — permanently ignore this server' },
        { value: 'skip', name: 'Skip — decide later' },
      ],
    });

    if (action === 'import') {
      servers[d.name] = d.server;
      imported++;
    } else if (action === 'exclude') {
      excluded.push(d.name);
      excludedCount++;
    }
    console.log();
  }

  if (imported > 0) {
    saveMcpServers(servers);
    success(`Imported ${imported} server(s)`);
  }

  if (excludedCount > 0) {
    saveMcpExclude(excluded);
    success(`Excluded ${excludedCount} server(s)`);
  }

  if (imported > 0) {
    info("Run 'devsync sync push' to propagate imported servers to hosts.");
  }
}
