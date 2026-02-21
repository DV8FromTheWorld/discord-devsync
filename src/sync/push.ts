import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { MERGED_DIR, type ResolvedHost } from '../config.js';
import { rsync, rsyncMirror, remotePath, hostExec, checkConnection } from '../ssh.js';
import { debug } from '../log.js';
import { pushDotfiles } from '../env/dotfiles.js';
import { pushSecrets } from '../env/secrets.js';
import { reconcileMcp } from '../env/mcp.js';
import { reconcilePermissions } from '../env/permissions.js';
import { type HostResult, timed, runParallel } from './parallel.js';

async function pushFilteredSkills(host: ResolvedHost): Promise<string | null> {
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

    const r = await rsyncMirror(tempDir + '/', remotePath(host, host.paths.skills + '/'));
    if (r.ok) return `skills (${hostSkills.length})`;
    return null;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function ensureRemoteDirs(host: ResolvedHost): Promise<void> {
  // dirname of claude_md path (e.g. ~/workspace/discord/ from ~/workspace/discord/CLAUDE.md)
  const claudeMdDir = host.paths.claude_md.replace(/\/[^/]+$/, '');
  const dirs = [claudeMdDir, host.paths.kb, host.paths.skills, '~/.claude'];
  const mkdirCmd = dirs.map((d) => `mkdir -p ${d}`).join(' && ');
  await hostExec(host, mkdirCmd);
}

async function pushHost(host: ResolvedHost): Promise<HostResult> {
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

  try {
    await ensureRemoteDirs(host);
  } catch {
    result.errors.push('failed to create remote directories');
    return result;
  }

  // All push operations are independent after ensureRemoteDirs — run in parallel
  const ops: Array<Promise<void>> = [];

  // CLAUDE.md
  const claudeMd = resolve(MERGED_DIR, 'CLAUDE.md');
  if (existsSync(claudeMd)) {
    ops.push(
      (async () => {
        const { result: r, ms } = await timed('claude.md', () =>
          rsync(claudeMd, remotePath(host, host.paths.claude_md)),
        );
        timings.push(`claude.md ${ms}ms`);
        if (r.ok) result.succeeded.push('CLAUDE.md');
        else {
          result.errors.push(`CLAUDE.md failed (${host.paths.claude_md})`);
          debug(`rsync CLAUDE.md: ${r.stderr.trim()}`);
        }
      })(),
    );
  }

  // KB
  const kbDir = resolve(MERGED_DIR, 'discord-kb');
  if (existsSync(kbDir)) {
    ops.push(
      (async () => {
        const { result: r, ms } = await timed('kb', () =>
          rsync(kbDir + '/', remotePath(host, host.paths.kb + '/'), ['--delete', '--exclude', 'journal/']),
        );
        timings.push(`kb ${ms}ms`);
        if (r.ok) result.succeeded.push('KB');
        else {
          result.errors.push(`KB failed (${host.paths.kb})`);
          debug(`rsync KB: ${r.stderr.trim()}`);
        }
      })(),
    );
  }

  // Filtered skills
  ops.push(
    (async () => {
      try {
        const { result: label, ms } = await timed('skills', () => pushFilteredSkills(host));
        timings.push(`skills ${ms}ms`);
        if (label) result.succeeded.push(label);
        else result.errors.push('skills failed');
      } catch {
        result.errors.push('skills failed');
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
          result.succeeded.push('dotfiles');
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
          result.succeeded.push('secrets');
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
          result.succeeded.push('MCP');
        } catch {
          result.errors.push('MCP failed');
        }
      })(),
    );
  }

  // Permissions
  ops.push(
    (async () => {
      try {
        const { result: didPush, ms } = await timed('perms', () => reconcilePermissions(host));
        timings.push(`perms ${ms}ms`);
        if (didPush) result.succeeded.push('permissions');
      } catch {
        result.errors.push('permissions failed');
      }
    })(),
  );

  await Promise.all(ops);

  const wall = Math.round(performance.now() - hostStart);
  debug(`${host.name} (${wall}ms) — ${timings.join(', ')}`);
  return result;
}

export async function push(hosts: ResolvedHost[]): Promise<void> {
  await runParallel('\nPush', hosts, pushHost);
}
