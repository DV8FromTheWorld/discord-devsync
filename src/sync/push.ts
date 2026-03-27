import {
  copyFileSync,
  existsSync,
  statSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  rmSync,
} from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { MERGED_DIR, REMOTES_DIR, type ResolvedHost } from '../config.js';
import { rsync, rsyncMirror, remotePath, hostExec, checkConnection } from '../ssh.js';
import { debug } from '../log.js';
import { pushDotfiles } from '../env/dotfiles.js';
import { pushSecrets } from '../env/secrets.js';
import { reconcileMcp } from '../env/mcp.js';
import { reconcilePermissions } from '../env/permissions.js';
import { reconcilePlugins } from '../env/plugins.js';
import { timed, runParallel } from './parallel.js';
import {
  type HostChanges,
  type ContentChange,
  type FileChange,
  parseRsyncItemize,
  aggregateToDirectories,
  snapshotTextFiles,
  diffBarForFiles,
  printHostChanges,
} from './changes.js';

async function pushFilteredSkills(host: ResolvedHost): Promise<ContentChange | null> {
  const mergedSkills = resolve(MERGED_DIR, '.claude', 'skills');
  if (!existsSync(mergedSkills)) return null;

  const allSkills = readdirSync(mergedSkills, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const hostSkills =
    host.skills === 'all'
      ? allSkills
      : allSkills.filter((s) => (host.skills as Set<string>).has(s));

  const tempDir = mkdtempSync(resolve(tmpdir(), 'devsync-skills-push-'));
  try {
    for (const skill of hostSkills) {
      const src = resolve(mergedSkills, skill);
      const dst = resolve(tempDir, skill);
      await rsync(src + '/', dst + '/');
    }

    // Snapshot cached state before push for diff bars
    const cachedSkillsDir = resolve(REMOTES_DIR, host.name, '.claude', 'skills');
    const oldSkillFiles = snapshotTextFiles(cachedSkillsDir);

    const r = await rsyncMirror(tempDir + '/', remotePath(host, host.paths.skills + '/'));
    if (!r.ok) return null;

    // Update local remotes cache so next fetch doesn't report these as new
    mkdirSync(cachedSkillsDir, { recursive: true });
    await rsyncMirror(tempDir + '/', cachedSkillsDir + '/');

    const rsyncChanges = parseRsyncItemize(r.stdout);
    if (rsyncChanges.length === 0) return null;

    const files = aggregateToDirectories(rsyncChanges, tempDir, oldSkillFiles);
    return files.length > 0 ? { label: 'skills', files } : null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function pushFilteredAgents(host: ResolvedHost): Promise<ContentChange | null> {
  const mergedAgents = resolve(MERGED_DIR, '.claude', 'agents');
  if (!existsSync(mergedAgents)) return null;

  const allAgents = readdirSync(mergedAgents, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name);

  const hostAgents =
    host.agents === 'all'
      ? allAgents
      : allAgents.filter((a) => (host.agents as Set<string>).has(a));

  if (hostAgents.length === 0) return null;

  const tempDir = mkdtempSync(resolve(tmpdir(), 'devsync-agents-push-'));
  try {
    for (const agent of hostAgents) {
      const src = resolve(mergedAgents, agent);
      const dst = resolve(tempDir, agent);
      await rsync(src, dst);
    }

    const r = await rsyncMirror(tempDir + '/', remotePath(host, '~/.claude/agents/'));
    if (!r.ok) return null;

    // Update local remotes cache so next fetch doesn't report these as new
    const cachedAgentsDir = resolve(REMOTES_DIR, host.name, '.claude', 'agents');
    mkdirSync(cachedAgentsDir, { recursive: true });
    await rsyncMirror(tempDir + '/', cachedAgentsDir + '/');

    const rsyncChanges = parseRsyncItemize(r.stdout);
    if (rsyncChanges.length === 0) return null;

    const files: FileChange[] = rsyncChanges.map((rc) => {
      const fc: FileChange = { name: rc.path, type: rc.type };
      if (rc.type === '~') {
        const cached = resolve(REMOTES_DIR, host.name, '.claude', 'agents', rc.path);
        const merged = resolve(mergedAgents, rc.path);
        fc.diffBar = diffBarForFiles(cached, merged);
      }
      return fc;
    });

    return files.length > 0 ? { label: 'agents', files } : null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function pushSingleFile(
  mergedFilename: string,
  remoteDest: string,
  label: string,
  host: ResolvedHost,
  result: HostChanges,
  timings: string[],
): Promise<void> {
  const mergedFile = resolve(MERGED_DIR, mergedFilename);
  if (!existsSync(mergedFile)) return;

  const { result: r, ms } = await timed(label, () => rsync(mergedFile, remoteDest));
  timings.push(`${label} ${ms}ms`);
  if (r.ok) {
    const changes = parseRsyncItemize(r.stdout);
    if (changes.length > 0) {
      const fc: FileChange = { name: mergedFilename, type: changes[0].type };
      if (changes[0].type === '~') {
        const cached = resolve(REMOTES_DIR, host.name, mergedFilename);
        fc.diffBar = diffBarForFiles(cached, mergedFile);
      }
      result.changes.push({ label, files: [fc] });
    }
    // Update local remotes cache (use read+write to avoid ENOTSUP on macOS,
    // and remove stale directory artifacts left by rsync for missing sources)
    const cachedDir = resolve(REMOTES_DIR, host.name);
    mkdirSync(cachedDir, { recursive: true });
    const cachedPath = resolve(cachedDir, mergedFilename);
    if (existsSync(cachedPath) && statSync(cachedPath).isDirectory()) {
      rmSync(cachedPath, { recursive: true, force: true });
    }
    writeFileSync(cachedPath, readFileSync(mergedFile));
  } else {
    result.errors.push(`${label} failed`);
    debug(`rsync ${label}: ${r.stderr.trim()}`);
  }
}

async function ensureRemoteDirs(host: ResolvedHost): Promise<void> {
  const userClaudeDir = host.paths.user_claude_md.replace(/\/[^/]+$/, '');
  const localClaudeDir = host.paths.claude_local_md.replace(/\/[^/]+$/, '');
  const dirs = [
    userClaudeDir,
    localClaudeDir,
    host.paths.kb,
    host.paths.skills,
    '~/.claude/agents',
  ];
  const mkdirCmd = dirs.map((d) => `mkdir -p ${d}`).join(' && ');
  await hostExec(host, mkdirCmd);
}

async function pushHost(host: ResolvedHost): Promise<HostChanges> {
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

  try {
    await ensureRemoteDirs(host);
  } catch {
    result.errors.push('failed to create remote directories');
    return result;
  }

  // All push operations are independent after ensureRemoteDirs — run in parallel
  const ops: Array<Promise<void>> = [];

  // User CLAUDE.md + CLAUDE.local.md
  ops.push(
    pushSingleFile(
      'user-CLAUDE.md',
      remotePath(host, host.paths.user_claude_md),
      'user CLAUDE.md',
      host,
      result,
      timings,
    ),
  );
  ops.push(
    pushSingleFile(
      'CLAUDE.local.md',
      remotePath(host, host.paths.claude_local_md),
      'CLAUDE.local.md',
      host,
      result,
      timings,
    ),
  );

  // KB (exclude journal/ — each host maintains its own journal entries)
  const kbDir = resolve(MERGED_DIR, 'discord-kb');
  if (existsSync(kbDir)) {
    ops.push(
      (async () => {
        const { result: r, ms } = await timed('kb', () =>
          rsync(kbDir + '/', remotePath(host, host.paths.kb + '/'), [
            '--delete',
            '--exclude',
            'journal/',
          ]),
        );
        timings.push(`kb ${ms}ms`);
        if (r.ok) {
          const rsyncChanges = parseRsyncItemize(r.stdout);
          if (rsyncChanges.length > 0) {
            const files: FileChange[] = rsyncChanges.map((rc) => {
              const fc: FileChange = { name: rc.path, type: rc.type };
              if (rc.type === '~') {
                const cached = resolve(REMOTES_DIR, host.name, 'discord-kb', rc.path);
                fc.diffBar = diffBarForFiles(cached, resolve(kbDir, rc.path));
              }
              return fc;
            });
            result.changes.push({ label: 'KB', files });
          }
          // Update local remotes cache
          const cachedKbDir = resolve(REMOTES_DIR, host.name, 'discord-kb');
          mkdirSync(cachedKbDir, { recursive: true });
          await rsync(kbDir + '/', cachedKbDir + '/', ['--delete', '--exclude', 'journal/']);
        } else {
          result.errors.push('KB failed');
          debug(`rsync KB: ${r.stderr.trim()}`);
        }
      })(),
    );
  }

  // Filtered skills
  ops.push(
    (async () => {
      try {
        const { result: change, ms } = await timed('skills', () => pushFilteredSkills(host));
        timings.push(`skills ${ms}ms`);
        if (change) result.changes.push(change);
      } catch {
        result.errors.push('skills failed');
      }
    })(),
  );

  // Filtered agents
  ops.push(
    (async () => {
      try {
        const { result: change, ms } = await timed('agents', () => pushFilteredAgents(host));
        timings.push(`agents ${ms}ms`);
        if (change) result.changes.push(change);
      } catch {
        result.errors.push('agents failed');
      }
    })(),
  );

  // Dotfiles
  if (host.dotfiles) {
    ops.push(
      (async () => {
        try {
          const { ms } = await timed('dotfiles', () => pushDotfiles(host));
          timings.push(`dotfiles ${ms}ms`);
        } catch {
          result.errors.push('dotfiles failed');
        }
      })(),
    );
  }

  // Secrets
  if (host.secrets) {
    ops.push(
      (async () => {
        try {
          const { ms } = await timed('secrets', () => pushSecrets(host));
          timings.push(`secrets ${ms}ms`);
        } catch {
          result.errors.push('secrets failed');
        }
      })(),
    );
  }

  // MCP
  if (host.mcp === 'all' || host.mcp.size > 0) {
    ops.push(
      (async () => {
        try {
          const { ms } = await timed('mcp', () => reconcileMcp(host));
          timings.push(`mcp ${ms}ms`);
        } catch {
          result.errors.push('MCP failed');
        }
      })(),
    );
  }

  // Permissions + enabled plugins (via settings.json)
  ops.push(
    (async () => {
      try {
        const { result: didPush, ms } = await timed('settings', () => reconcilePermissions(host));
        timings.push(`settings ${ms}ms`);
        if (didPush) {
          // Count new permissions relative to what host had
          const permFile = resolve(REMOTES_DIR, host.name, 'permissions.json');
          let newCount = 0;
          try {
            const merged = JSON.parse(
              readFileSync(resolve(MERGED_DIR, 'permissions.json'), 'utf-8'),
            );
            if (Array.isArray(merged)) {
              if (existsSync(permFile)) {
                const old = JSON.parse(readFileSync(permFile, 'utf-8'));
                if (Array.isArray(old)) newCount = merged.length - old.length;
              } else {
                newCount = merged.length;
              }
            }
          } catch {
            /* skip */
          }
          if (newCount > 0) {
            result.changes.push({ label: 'permissions', summary: `+${newCount} rules` });
          }
        }
      } catch {
        result.errors.push('settings failed');
      }
    })(),
  );

  // Plugin cache + installed metadata
  ops.push(
    (async () => {
      try {
        const { result: didPush, ms } = await timed('plugins', () => reconcilePlugins(host));
        timings.push(`plugins ${ms}ms`);
        if (didPush) {
          result.changes.push({ label: 'plugins', summary: 'updated' });
        }
      } catch {
        result.errors.push('plugins failed');
      }
    })(),
  );

  await Promise.all(ops);

  const wall = Math.round(performance.now() - hostStart);
  debug(`${host.name} (${wall}ms) — ${timings.join(', ')}`);
  return result;
}

export async function push(hosts: ResolvedHost[]): Promise<void> {
  await runParallel('\nPush', hosts, pushHost, printHostChanges);
}
