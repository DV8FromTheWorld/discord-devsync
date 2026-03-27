import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, type ResolvedHost } from '../config.js';
import { rsync, rsyncMirror, remotePath, checkConnection, hostExec } from '../ssh.js';
import { debug } from '../log.js';
import { timed, runParallel } from './parallel.js';
import {
  type HostChanges,
  type ContentChange,
  type FileChange,
  parseRsyncItemize,
  buildFileChanges,
  aggregateToDirectories,
  snapshotTextFiles,
  computeDiffStats,
  formatDiffBar,
  printHostChanges,
} from './changes.js';

async function fetchSettings(host: ResolvedHost, remoteDir: string): Promise<boolean> {
  const result = await hostExec(host, 'cat ~/.claude/settings.json 2>/dev/null');
  if (!result.ok || !result.stdout.trim()) return false;

  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(result.stdout.trim());
  } catch {
    return false;
  }

  let fetched = false;

  const permissions = settings.permissions as Record<string, unknown> | undefined;
  const allow = permissions?.allow;
  if (Array.isArray(allow) && allow.length > 0) {
    writeFileSync(resolve(remoteDir, 'permissions.json'), JSON.stringify(allow, null, 2) + '\n');
    fetched = true;
  }

  const enabledPlugins = settings.enabledPlugins;
  if (enabledPlugins && typeof enabledPlugins === 'object' && !Array.isArray(enabledPlugins)) {
    writeFileSync(
      resolve(remoteDir, 'plugins-enabled.json'),
      JSON.stringify(enabledPlugins, null, 2) + '\n',
    );
    fetched = true;
  }

  return fetched;
}

async function fetchPlugins(host: ResolvedHost, remoteDir: string): Promise<boolean> {
  let fetched = false;

  // Fetch installed_plugins.json
  const installedResult = await hostExec(
    host,
    'cat ~/.claude/plugins/installed_plugins.json 2>/dev/null',
  );
  if (installedResult.ok && installedResult.stdout.trim()) {
    try {
      JSON.parse(installedResult.stdout.trim()); // validate
      writeFileSync(
        resolve(remoteDir, 'installed-plugins.json'),
        installedResult.stdout.trim() + '\n',
      );
      fetched = true;
    } catch {
      // Skip invalid JSON
    }
  }

  // Fetch plugin cache via rsync
  const cacheDir = resolve(remoteDir, '.claude', 'plugins', 'cache');
  mkdirSync(cacheDir, { recursive: true });
  const r = await rsyncMirror(remotePath(host, '~/.claude/plugins/cache/'), cacheDir + '/');
  if (r.ok) fetched = true;

  return fetched;
}

async function fetchMcpServers(
  host: ResolvedHost,
  remoteDir: string,
): Promise<ContentChange | null> {
  // Read old state for comparison
  const mcpFile = resolve(remoteDir, 'mcp-servers.json');
  let oldServerNames = new Set<string>();
  if (existsSync(mcpFile)) {
    try {
      const old = JSON.parse(readFileSync(mcpFile, 'utf-8'));
      oldServerNames = new Set(Object.keys(old));
    } catch {
      /* ignore */
    }
  }

  const result = await hostExec(host, 'cat ~/.claude.json 2>/dev/null');
  if (!result.ok || !result.stdout.trim()) return null;

  let claudeJson: Record<string, unknown>;
  try {
    claudeJson = JSON.parse(result.stdout.trim());
  } catch {
    return null;
  }

  // Collect MCP servers from all scopes (user + project-scoped)
  const allServers: Record<string, unknown> = {};

  // User-scoped (top-level mcpServers)
  const userServers = claudeJson.mcpServers;
  if (userServers && typeof userServers === 'object') {
    Object.assign(allServers, userServers);
  }

  // Project-scoped (under projects[path].mcpServers)
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

  if (Object.keys(allServers).length === 0) return null;

  writeFileSync(resolve(remoteDir, 'mcp-servers.json'), JSON.stringify(allServers, null, 2) + '\n');

  // Compare old vs new
  const files: FileChange[] = [];
  for (const name of Object.keys(allServers)) {
    if (!oldServerNames.has(name)) {
      files.push({ name, type: '+' });
    }
    // Modified servers are rare and hard to show meaningfully — skip
  }

  return files.length > 0 ? { label: 'MCP', files } : null;
}

async function fetchHost(host: ResolvedHost): Promise<HostChanges> {
  const hostStart = performance.now();
  const result: HostChanges = { host: host.name, unreachable: false, changes: [], errors: [] };
  const timings: string[] = [];

  // Check connectivity first (skip for localhost)
  if (!host.isLocal) {
    const { result: reachable, ms } = await timed('connect', () => checkConnection(host));
    timings.push(`connect:${ms}ms`);
    if (!reachable) {
      result.unreachable = true;
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

  // Snapshot existing files before fetch for diff bar computation
  const readIfFile = (p: string) =>
    existsSync(p) && statSync(p).isFile() ? readFileSync(p, 'utf-8') : null;
  const userClaudePath = resolve(remoteDir, 'user-CLAUDE.md');
  const oldUserClaude = readIfFile(userClaudePath);
  const localClaudePath = resolve(remoteDir, 'CLAUDE.local.md');
  const oldLocalClaude = readIfFile(localClaudePath);
  const oldKbFiles = snapshotTextFiles(kbDir);
  const oldSkillFiles = snapshotTextFiles(skillsDir);
  const oldAgentFiles = snapshotTextFiles(agentsDir);

  // Run all fetch operations in parallel — they're independent
  const [userClaudeT, localClaudeT, kbT, skillsT, agentsT, mcpT, permT, pluginsT] =
    await Promise.all([
      timed('user-claude', () =>
        rsync(remotePath(host, host.paths.user_claude_md), resolve(remoteDir, 'user-CLAUDE.md')),
      ),
      timed('claude-local', () =>
        rsync(
          remotePath(host, host.paths.claude_local_md),
          resolve(remoteDir, 'CLAUDE.local.md'),
        ),
      ),
      timed('kb', () => rsyncMirror(remotePath(host, host.paths.kb + '/'), kbDir + '/')),
      timed('skills', () =>
        rsyncMirror(remotePath(host, host.paths.skills + '/'), skillsDir + '/'),
      ),
      timed('agents', () => rsyncMirror(remotePath(host, '~/.claude/agents/'), agentsDir + '/')),
      timed('mcp', () => fetchMcpServers(host, remoteDir)),
      timed('settings', () => fetchSettings(host, remoteDir)),
      timed('plugins', () => fetchPlugins(host, remoteDir)),
    ]);

  timings.push(
    `user-claude ${userClaudeT.ms}ms`,
    `claude-local ${localClaudeT.ms}ms`,
    `kb ${kbT.ms}ms`,
    `skills ${skillsT.ms}ms`,
    `agents ${agentsT.ms}ms`,
    `mcp ${mcpT.ms}ms`,
    `settings ${permT.ms}ms`,
    `plugins ${pluginsT.ms}ms`,
  );

  // ── Build change list from rsync output ──

  // User CLAUDE.md and CLAUDE.local.md (single files)
  for (const { timedResult, fileName, oldContent, label } of [
    {
      timedResult: userClaudeT,
      fileName: 'user-CLAUDE.md',
      oldContent: oldUserClaude,
      label: 'user CLAUDE.md',
    },
    {
      timedResult: localClaudeT,
      fileName: 'CLAUDE.local.md',
      oldContent: oldLocalClaude,
      label: 'CLAUDE.local.md',
    },
  ]) {
    if (timedResult.result.ok) {
      const rsyncChanges = parseRsyncItemize(timedResult.result.stdout);
      if (rsyncChanges.length > 0) {
        const fc: FileChange = { name: fileName, type: rsyncChanges[0].type };
        if (rsyncChanges[0].type === '~' && oldContent) {
          try {
            const newContent = readFileSync(resolve(remoteDir, fileName), 'utf-8');
            const stats = computeDiffStats(oldContent, newContent);
            if (stats.added > 0 || stats.removed > 0) {
              fc.diffBar = formatDiffBar(stats.added, stats.removed);
            }
          } catch {
            /* skip */
          }
        }
        result.changes.push({ label, files: [fc] });
      }
    }
  }

  // KB (directory)
  if (kbT.result.ok) {
    const files = buildFileChanges(kbT.result.stdout, kbDir, oldKbFiles);
    if (files.length > 0) {
      result.changes.push({ label: 'KB', files });
    }
  }

  // Skills (aggregate to directory level)
  if (skillsT.result.ok) {
    const rsyncChanges = parseRsyncItemize(skillsT.result.stdout);
    if (rsyncChanges.length > 0) {
      const files = aggregateToDirectories(rsyncChanges, skillsDir, oldSkillFiles);
      if (files.length > 0) {
        result.changes.push({ label: 'skills', files });
      }
    }
  }

  // Agents (individual files)
  if (agentsT.result.ok) {
    const files = buildFileChanges(agentsT.result.stdout, agentsDir, oldAgentFiles);
    if (files.length > 0) {
      result.changes.push({ label: 'agents', files });
    }
  }

  // MCP (compared internally by fetchMcpServers)
  if (mcpT.result) {
    result.changes.push(mcpT.result);
  }

  // Record successful fetch timestamp
  writeFileSync(resolve(remoteDir, '.last-fetch'), new Date().toISOString() + '\n');

  const wall = Math.round(performance.now() - hostStart);
  debug(`${host.name} (${wall}ms) — ${timings.join(', ')}`);
  return result;
}

export async function fetch(hosts: ResolvedHost[]): Promise<void> {
  await runParallel('Pull', hosts, fetchHost, printHostChanges);
}
