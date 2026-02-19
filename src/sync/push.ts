import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import ora from 'ora';
import { MERGED_DIR, type ResolvedHost } from '../config.js';
import { rsync, rsyncDelete, remotePath } from '../ssh.js';
import { pushDotfiles } from '../env/dotfiles.js';
import { pushSecrets } from '../env/secrets.js';
import { reconcileMcp } from '../env/mcp.js';

function pushClaudeContent(host: ResolvedHost, errors: string[]): string[] {
  const pushed: string[] = [];

  const claudeMd = resolve(MERGED_DIR, 'CLAUDE.md');
  if (existsSync(claudeMd)) {
    const r = rsync(claudeMd, remotePath(host, host.paths.claude_md));
    if (r.ok) pushed.push('CLAUDE.md');
    else errors.push('CLAUDE.md failed');
  }

  const kbDir = resolve(MERGED_DIR, 'discord-kb');
  if (existsSync(kbDir)) {
    const r = rsyncDelete(kbDir + '/', remotePath(host, host.paths.kb + '/'));
    if (r.ok) pushed.push('KB');
    else errors.push('KB failed');
  }

  pushFilteredSkills(host, pushed, errors);
  return pushed;
}

function pushFilteredSkills(host: ResolvedHost, pushed: string[], errors: string[]): void {
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
      rsync(src + '/', dst + '/');
    }

    const r = rsyncDelete(tempDir + '/', remotePath(host, host.paths.skills + '/'));
    if (r.ok) pushed.push(`skills (${hostSkills.length})`);
    else errors.push('skills failed');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function pushHost(host: ResolvedHost): { pushed: string[]; errors: string[] } {
  const errors: string[] = [];
  const pushed = pushClaudeContent(host, errors);

  if (host.dotfiles) {
    try {
      pushDotfiles(host);
      pushed.push('dotfiles');
    } catch {
      errors.push('dotfiles failed');
    }
  }

  if (host.secrets) {
    try {
      pushSecrets(host);
      pushed.push('secrets');
    } catch {
      errors.push('secrets failed');
    }
  }

  if (host.mcp.size > 0) {
    try {
      reconcileMcp(host);
      pushed.push('MCP');
    } catch {
      errors.push('MCP failed');
    }
  }

  return { pushed, errors };
}

export function push(hosts: ResolvedHost[]): void {
  if (hosts.length === 0) {
    console.log('No hosts configured.');
    return;
  }

  console.log();

  let succeeded = 0;
  let failed = 0;

  for (const host of hosts) {
    const spinner = ora({ text: host.name, prefixText: '  ' }).start();
    const { pushed, errors } = pushHost(host);

    if (errors.length === 0) {
      spinner.succeed(`${host.name} — ${pushed.join(', ')}`);
      succeeded++;
    } else if (pushed.length > 0) {
      spinner.warn(`${host.name} — ${pushed.join(', ')} (${errors.join('; ')})`);
      succeeded++;
    } else {
      spinner.fail(`${host.name} — ${errors.join('; ')}`);
      failed++;
    }
  }

  console.log();
  const summary = [`${succeeded} ok`, failed > 0 ? `${failed} failed` : '']
    .filter(Boolean)
    .join(', ');
  ora().succeed(`Push complete (${summary})`);
}
