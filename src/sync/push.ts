import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import ora from 'ora';
import { MERGED_DIR, type ResolvedHost } from '../config.js';
import { rsync, rsyncMirror, remotePath, hostExec } from '../ssh.js';
import { pushDotfiles } from '../env/dotfiles.js';
import { pushSecrets } from '../env/secrets.js';
import { reconcileMcp } from '../env/mcp.js';
import { reconcilePermissions } from '../env/permissions.js';

async function pushClaudeContent(host: ResolvedHost, errors: string[]): Promise<string[]> {
  const pushed: string[] = [];

  const claudeMd = resolve(MERGED_DIR, 'CLAUDE.md');
  if (existsSync(claudeMd)) {
    const r = await rsync(claudeMd, remotePath(host, host.paths.claude_md));
    if (r.ok) pushed.push('CLAUDE.md');
    else errors.push('CLAUDE.md failed');
  }

  const kbDir = resolve(MERGED_DIR, 'discord-kb');
  if (existsSync(kbDir)) {
    const r = await rsyncMirror(kbDir + '/', remotePath(host, host.paths.kb + '/'));
    if (r.ok) pushed.push('KB');
    else errors.push('KB failed');
  }

  await pushFilteredSkills(host, pushed, errors);
  return pushed;
}

async function pushFilteredSkills(
  host: ResolvedHost,
  pushed: string[],
  errors: string[],
): Promise<void> {
  const mergedSkills = resolve(MERGED_DIR, '.claude', 'skills');
  if (!existsSync(mergedSkills)) return;

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
    if (r.ok) pushed.push(`skills (${hostSkills.length})`);
    else errors.push('skills failed');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function ensureRemoteDirs(host: ResolvedHost): Promise<void> {
  const dirs = [host.paths.kb, host.paths.skills, '~/.claude'];
  const mkdirCmd = dirs.map((d) => `mkdir -p ${d}`).join(' && ');
  await hostExec(host, mkdirCmd);
}

async function pushHost(host: ResolvedHost): Promise<{ pushed: string[]; errors: string[] }> {
  const errors: string[] = [];
  await ensureRemoteDirs(host);
  const pushed = await pushClaudeContent(host, errors);

  if (host.dotfiles) {
    try {
      await pushDotfiles(host);
      pushed.push('dotfiles');
    } catch {
      errors.push('dotfiles failed');
    }
  }

  if (host.secrets) {
    try {
      await pushSecrets(host);
      pushed.push('secrets');
    } catch {
      errors.push('secrets failed');
    }
  }

  if (host.mcp === 'all' || host.mcp.size > 0) {
    try {
      await reconcileMcp(host);
      pushed.push('MCP');
    } catch {
      errors.push('MCP failed');
    }
  }

  try {
    const didPush = await reconcilePermissions(host);
    if (didPush) pushed.push('permissions');
  } catch {
    errors.push('permissions failed');
  }

  return { pushed, errors };
}

export async function push(hosts: ResolvedHost[]): Promise<void> {
  if (hosts.length === 0) {
    console.log('No hosts configured.');
    return;
  }

  console.log();

  let succeeded = 0;
  let failed = 0;

  for (const host of hosts) {
    const spinner = ora({ text: host.name, prefixText: '  ' }).start();
    const { pushed, errors } = await pushHost(host);
    spinner.stop();

    if (errors.length === 0) {
      ora({ prefixText: '  ' }).succeed(`${host.name} — ${pushed.join(', ')}`);
      succeeded++;
    } else if (pushed.length > 0) {
      ora({ prefixText: '  ' }).warn(host.name);
      console.log(`        ${pushed.join(', ')}`);
      for (const err of errors) {
        console.log(`      \x1b[31m✖\x1b[0m ${err}`);
      }
      succeeded++;
    } else {
      ora({ prefixText: '  ' }).fail(host.name);
      for (const err of errors) {
        console.log(`      \x1b[31m✖\x1b[0m ${err}`);
      }
      failed++;
    }
  }

  console.log();
  const summary = [`${succeeded} ok`, failed > 0 ? `${failed} failed` : '']
    .filter(Boolean)
    .join(', ');
  ora().succeed(`Push complete (${summary})`);
}
