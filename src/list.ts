import { loadConfig, loadMcpConfig, getHostPaths } from './config.js';

export function listHosts(): void {
  const config = loadConfig();
  const hosts = Object.entries(config.hosts);

  if (hosts.length === 0) {
    console.log("No hosts configured. Run 'devsync host add' to add one.");
    return;
  }

  console.log(`Hosts (${hosts.length}):\n`);
  for (const [name, host] of hosts) {
    const paths = getHostPaths(config, host);
    const isLocal = host.hostname === 'localhost';
    console.log(`  ${name}${isLocal ? ' (local)' : ''}`);
    console.log(`    hostname:  ${host.hostname}`);
    console.log(`    platform:  ${host.platform}`);
    console.log(`    layers:    ${host.layers.join(', ')}`);
    console.log(`    claude_md: ${paths.claude_md}`);
    console.log(`    kb:        ${paths.kb}`);
    console.log(`    skills:    ${paths.skills}`);
    console.log();
  }
}

export function listLayers(): void {
  const config = loadConfig();
  const layers = Object.entries(config.layers);

  if (layers.length === 0) {
    console.log('No layers configured.');
    return;
  }

  console.log(`Layers (${layers.length}):\n`);
  for (const [name, layer] of layers) {
    console.log(`  ${name}`);
    if (layer.description) console.log(`    ${layer.description}`);
    console.log(
      `    skills:   ${layer.skills === 'all' ? 'all' : (layer.skills ?? []).join(', ') || 'none'}`,
    );
    console.log(`    mcp:      ${(layer.mcp ?? []).join(', ') || 'none'}`);
    console.log(`    dotfiles: ${layer.dotfiles ? 'yes' : 'no'}`);
    console.log(`    secrets:  ${layer.secrets ? 'yes' : 'no'}`);
    console.log();
  }
}

export function listMcp(): void {
  const mcpConfig = loadMcpConfig();
  const servers = Object.entries(mcpConfig.servers);

  if (servers.length === 0) {
    console.log('No MCP servers configured in mcp-servers.yaml.');
    return;
  }

  console.log(`MCP Servers (${servers.length}):\n`);
  for (const [name, server] of servers) {
    console.log(`  ${name}`);
    console.log(`    transport: ${server.transport}`);
    if (server.url) console.log(`    url:       ${server.url}`);
    if (server.command)
      console.log(`    command:   ${server.command} ${(server.args ?? []).join(' ')}`);
    console.log();
  }
}
