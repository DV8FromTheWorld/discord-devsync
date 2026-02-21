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
  if (server.type === 'http' || server.type === 'sse') {
    const resolved: typeof server = { type: server.type, url: resolveEnvVars(server.url, secrets) };
    if (server.headers) {
      resolved.headers = {};
      for (const [k, v] of Object.entries(server.headers)) {
        resolved.headers[k] = resolveEnvVars(v, secrets);
      }
    }
    return resolved;
  } else {
    const resolved: typeof server = { type: 'stdio', command: server.command };
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
  const serverNames = host.mcp === 'all' ? Object.keys(allServers) : [...host.mcp];
  for (const serverName of serverNames) {
    const server = allServers[serverName];
    if (!server) {
      warn(`  MCP server '${serverName}' in layer config but not in merged servers`);
      continue;
    }
    filteredServers[serverName] = resolveServerSecrets(server, secrets);
  }

  try {
    const claudeJson = await readRemoteJson(host, '~/.claude.json');
    claudeJson.mcpServers = filteredServers;

    // Clean up project-scoped duplicates — remove servers we're pushing to user scope
    // from any project-specific mcpServers to prevent config drift
    const pushedNames = Object.keys(filteredServers);
    const projects = claudeJson.projects as Record<string, Record<string, unknown>> | undefined;
    if (projects && typeof projects === 'object') {
      for (const projectData of Object.values(projects)) {
        const projectMcp = projectData.mcpServers as Record<string, unknown> | undefined;
        if (!projectMcp || typeof projectMcp !== 'object') continue;
        for (const name of pushedNames) {
          if (name in projectMcp) {
            delete projectMcp[name];
          }
        }
      }
    }

    await writeRemoteJson(host, '~/.claude.json', claudeJson);
  } catch (e) {
    warn(`  MCP reconciliation failed for ${host.name}: ${(e as Error).message}`);
    throw e;
  }
}
