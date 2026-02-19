import { loadMcpServers, saveMcpServers } from './config.js';
import { success, error } from './log.js';

export function mcpRemove(name: string): void {
  const servers = loadMcpServers();

  if (!(name in servers)) {
    error(`MCP server '${name}' not found.`);
    const available = Object.keys(servers);
    if (available.length > 0) {
      console.log(`Available servers: ${available.join(', ')}`);
    }
    return;
  }

  delete servers[name];
  saveMcpServers(servers);
  success(`Removed MCP server '${name}'. Run 'devsync sync push' to propagate removal to hosts.`);
}
