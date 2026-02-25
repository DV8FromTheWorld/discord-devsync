import { input, select } from '@inquirer/prompts';
import { loadMcpServers, saveMcpServers, type McpServer } from './config.js';
import { success, error, warn } from './log.js';

function parseKeyValuePairs(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!raw.trim()) return result;
  for (const pair of raw.split(',').map((s) => s.trim())) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) continue;
    result[pair.slice(0, eqIdx).trim()] = pair.slice(eqIdx + 1).trim();
  }
  return result;
}

export async function mcpAdd(name?: string): Promise<void> {
  if (!name) {
    name = await input({ message: 'Server name:' });
    if (!name.trim()) {
      error('Server name is required.');
      return;
    }
  }

  const servers = loadMcpServers();
  if (name in servers) {
    warn(`Server '${name}' already exists. It will be overwritten.`);
  }

  const type = await select<'http' | 'sse' | 'stdio'>({
    message: 'Transport type:',
    choices: [
      { value: 'http', name: 'HTTP (remote server)' },
      { value: 'sse', name: 'SSE (server-sent events)' },
      { value: 'stdio', name: 'Stdio (local process)' },
    ],
  });

  let server: McpServer;

  if (type === 'http' || type === 'sse') {
    const url = await input({ message: 'Server URL:' });
    if (!url.trim()) {
      error(`URL is required for ${type.toUpperCase()} servers.`);
      return;
    }

    const headersRaw = await input({
      message: 'Headers (key=value, comma-separated, or empty):',
      default: '',
    });
    const headers = parseKeyValuePairs(headersRaw);

    server = { type, url } as McpServer;
    if (Object.keys(headers).length > 0) (server as McpServer & { headers?: Record<string, string> }).headers = headers;
  } else {
    const command = await input({ message: 'Command:' });
    if (!command.trim()) {
      error('Command is required for stdio servers.');
      return;
    }

    const argsRaw = await input({
      message: 'Arguments (space-separated, or empty):',
      default: '',
    });
    const args = argsRaw.trim() ? argsRaw.trim().split(/\s+/) : [];

    const envRaw = await input({
      message: 'Environment variables (KEY=value, comma-separated, or empty):',
      default: '',
    });
    const env = parseKeyValuePairs(envRaw);

    server = { type: 'stdio', command };
    if (args.length > 0) server.args = args;
    if (Object.keys(env).length > 0) server.env = env;
  }

  servers[name] = server;
  saveMcpServers(servers);
  success(`Added MCP server '${name}'`);
}
