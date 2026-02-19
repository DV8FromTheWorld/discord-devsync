import { loadMcpConfig, type McpServer, type ResolvedHost } from '../config.js';
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
  const mcpConfig = loadMcpConfig();
  const secrets = loadSecrets();

  for (const serverName of host.mcp) {
    const server = mcpConfig.servers[serverName];
    if (!server) continue;

    const addCmd = buildMcpAddCommand(serverName, server, secrets);
    sshRun(host, `claude mcp remove ${serverName} 2>/dev/null || true`);
    sshRun(host, addCmd.join(' '));
  }
}
