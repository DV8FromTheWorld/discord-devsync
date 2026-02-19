import { loadMcpServers, type McpServer, type ResolvedHost } from '../config.js';
import { readRemoteJson, writeRemoteJson } from '../ssh.js';
import { loadSecrets } from './secrets.js';
import { warn } from '../log.js';

function resolveEnvVars(value: string, secrets: Record<string, string>): string {
  return value.replace(/\$\{(\w+)\}/g, (_, varName) => secrets[varName] ?? `\${${varName}}`);
}

function resolveServerSecrets(
  server: McpServer,
  secrets: Record<string, string>,
): McpServer {
  if (server.type === 'http') {
    const resolved: McpServer = { type: 'http', url: resolveEnvVars(server.url, secrets) };
    if (server.headers) {
      resolved.headers = {};
      for (const [k, v] of Object.entries(server.headers)) {
        resolved.headers[k] = resolveEnvVars(v, secrets);
      }
    }
    return resolved;
  } else {
    const resolved: McpServer = { type: 'stdio', command: server.command };
    if (server.args) resolved.args = [...server.args];
    if (server.env) {
      resolved.env = {};
      for (const [k, v] of Object.entries(server.env)) {
        resolved.env[k] = resolveEnvVars(v, secrets);
      }
    }
    return resolved;
  }
}

export async function reconcileMcp(host: ResolvedHost): Promise<void> {
  const allServers = loadMcpServers();
  const secrets = loadSecrets();

  const filteredServers: Record<string, McpServer> = {};
  for (const serverName of host.mcp) {
    const server = allServers[serverName];
    if (!server) {
      warn(`  MCP server '${serverName}' in layer config but not in merged servers`, 'mcp');
      continue;
    }
    filteredServers[serverName] = resolveServerSecrets(server, secrets);
  }

  try {
    const claudeJson = await readRemoteJson(host, '~/.claude.json');
    claudeJson.mcpServers = filteredServers;
    await writeRemoteJson(host, '~/.claude.json', claudeJson);
  } catch (e) {
    warn(`  MCP reconciliation failed for ${host.name}: ${(e as Error).message}`, 'mcp');
    throw e;
  }
}
