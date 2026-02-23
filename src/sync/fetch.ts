import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, type ResolvedHost } from '../config.js';
import { rsync, rsyncMirror, remotePath, checkConnection, hostExec } from '../ssh.js';
import { debug } from '../log.js';
import { type HostResult, timed, runParallel } from './parallel.js';

async function fetchPermissions(host: ResolvedHost, remoteDir: string): Promise<boolean> {
  const result = await hostExec(host, 'cat ~/.claude/settings.json 2>/dev/null');
  if (!result.ok || !result.stdout.trim()) return false;

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(result.stdout.trim());
  } catch {
    return false;
  }

  const permissions = settings.permissions as Record<string, unknown> | undefined;
  const allow = permissions?.allow;
  if (!Array.isArray(allow) || allow.length === 0) return false;

  writeFileSync(resolve(remoteDir, 'permissions.json'), JSON.stringify(allow, null, 2) + '\n');
  return true;
}

async function fetchMcpServers(host: ResolvedHost, remoteDir: string): Promise<boolean> {
  const result = await hostExec(host, 'cat ~/.claude.json 2>/dev/null');
  if (!result.ok || !result.stdout.trim()) return false;

  let claudeJson: Record<string, unknown>;
  try {
    claudeJson = JSON.parse(result.stdout.trim());
  } catch {
    return false;
  }

  // Collect MCP servers from all scopes (user + project-scoped)
  const allServers: Record<string, unknown> = {};

  // User-scoped (top-level mcpServers)
  const userServers = claudeJson.mcpServers;
  if (userServers && typeof userServers === 'object') {
    Object.assign(allServers, userServers);
  }

  // Project-scoped (under projects[path].mcpServers) — picks up servers added
  // with default `--scope local` which most people use without thinking
  const projects = claudeJson.projects;
  if (projects && typeof projects === 'object') {
    for (const projectData of Object.values(projects)) {
      const data = projectData as Record<string, unknown>;
      const mcpServers = data.mcpServers;
      if (mcpServers && typeof mcpServers === 'object') {
        Object.assign(allServers, mcpServers);
      }
    }
  }

  if (Object.keys(allServers).length === 0) return false;

  writeFileSync(resolve(remoteDir, 'mcp-servers.json'), JSON.stringify(allServers, null, 2) + '\n');
  return true;
}

async function fetchHost(host: ResolvedHost): Promise<HostResult> {
  const hostStart = performance.now();
  const result: HostResult = { host: host.name, succeeded: [], errors: [], unreachable: false };
  const timings: string[] = [];

  // Check connectivity first (skip for localhost)
  if (!host.isLocal) {
    const { result: reachable, ms } = await timed('connect', () => checkConnection(host));
    timings.push(`connect:${ms}ms`);
    if (!reachable) {
      result.unreachable = true;
      result.errors.push('host unreachable');
      const wall = Math.round(performance.now() - hostStart);
      debug(`${host.name} (${wall}ms) — ${timings.join(', ')}`);
      return result;
    }
  }

  const remoteDir = resolve(REMOTES_DIR, host.name);
  mkdirSync(remoteDir, { recursive: true });
  const kbDir = resolve(remoteDir, 'discord-kb');
  mkdirSync(kbDir, { recursive: true });
  const skillsDir = resolve(remoteDir, '.claude', 'skills');
  mkdirSync(skillsDir, { recursive: true });
  const agentsDir = resolve(remoteDir, '.claude', 'agents');
  mkdirSync(agentsDir, { recursive: true });

  // Run all fetch operations in parallel — they're independent
  const [claudeT, kbT, skillsT, agentsT, mcpT, permT] = await Promise.all([
    timed('claude.md', () =>
      rsync(remotePath(host, host.paths.claude_md), resolve(remoteDir, 'CLAUDE.md')),
    ),
    timed('kb', () => rsyncMirror(remotePath(host, host.paths.kb + '/'), kbDir + '/')),
    timed('skills', () =>
      rsyncMirror(remotePath(host, host.paths.skills + '/'), skillsDir + '/'),
    ),
    timed('agents', () =>
      rsyncMirror(remotePath(host, '~/.claude/agents/'), agentsDir + '/'),
    ),
    timed('mcp', () => fetchMcpServers(host, remoteDir)),
    timed('perms', () => fetchPermissions(host, remoteDir)),
  ]);

  timings.push(
    `claude.md ${claudeT.ms}ms`,
    `kb ${kbT.ms}ms`,
    `skills ${skillsT.ms}ms`,
    `agents ${agentsT.ms}ms`,
    `mcp ${mcpT.ms}ms`,
    `perms ${permT.ms}ms`,
  );

  if (claudeT.result.ok) result.succeeded.push('CLAUDE.md');
  else result.errors.push(`CLAUDE.md not found (${host.paths.claude_md})`);

  if (kbT.result.ok) result.succeeded.push('KB');
  else result.errors.push(`KB not found (${host.paths.kb})`);

  if (skillsT.result.ok) result.succeeded.push('skills');
  else result.errors.push(`skills not found (${host.paths.skills})`);

  if (agentsT.result.ok) result.succeeded.push('agents');
  else result.errors.push('agents not found (~/.claude/agents)');

  result.succeeded.push(mcpT.result ? 'MCP' : 'MCP (none)');
  result.succeeded.push(permT.result ? 'permissions' : 'permissions (none)');

  const wall = Math.round(performance.now() - hostStart);
  debug(`${host.name} (${wall}ms) — ${timings.join(', ')}`);
  return result;
}

export async function fetch(hosts: ResolvedHost[]): Promise<void> {
  await runParallel('Pull', hosts, fetchHost);
}
