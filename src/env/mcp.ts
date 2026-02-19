import { loadMcpConfig, type McpServer, type ResolvedHost } from '../config.js';
import { info, success, warn } from '../log.js';
import { sshRun } from '../ssh.js';
import { loadSecrets } from './secrets.js';

function resolveEnvVars(value: string, secrets: Record<string, string>): string {
  return value.replace(/\$\{(\w+)\}/g, (_, varName) => secrets[varName] ?? `\${${varName}}`);
}

function buildMcpAddCommand(
  name: string,
  server: McpServer,
  secrets: Record<string, string>,
): string[] {
  const args = ['claude', 'mcp', 'add', '--scope', 'user'];

  if (server.transport === 'http') {
    args.push('--transport', 'http');
    if (server.headers) {
      for (const [key, value] of Object.entries(server.headers)) {
        args.push('--header', `${key}: ${resolveEnvVars(value, secrets)}`);
      }
    }
    args.push(name, resolveEnvVars(server.url!, secrets));
  } else {
    args.push('--transport', 'stdio');
    if (server.env) {
      for (const [key, value] of Object.entries(server.env)) {
        args.push('--env', `${key}=${resolveEnvVars(value, secrets)}`);
      }
    }
    args.push(name, '--', server.command!);
    if (server.args) args.push(...server.args);
  }

  return args;
}

export function reconcileMcp(host: ResolvedHost): void {
  info(`  Reconciling MCP servers for ${host.name}`, 'mcp');

  const mcpConfig = loadMcpConfig();
  const secrets = loadSecrets();

  // Desired servers for this host
  const desired = new Set<string>();
  for (const serverName of host.mcp) {
    if (mcpConfig.servers[serverName]) {
      desired.add(serverName);
    } else {
      warn(
        `  MCP server '${serverName}' referenced in layers but not defined in mcp-servers.yaml`,
        'mcp',
      );
    }
  }

  // Add missing servers
  for (const name of desired) {
    const server = mcpConfig.servers[name];
    const addCmd = buildMcpAddCommand(name, server, secrets);
    info(`    Adding MCP server '${name}'`, 'mcp');

    // Remove first to ensure clean state, then add
    sshRun(host, `claude mcp remove ${name} 2>/dev/null || true`);
    const result = sshRun(host, addCmd.join(' '));
    if (result.ok) {
      success(`    MCP server '${name}' configured`, 'mcp');
    } else {
      warn(`    Failed to configure MCP server '${name}': ${result.stderr}`, 'mcp');
    }
  }
}
