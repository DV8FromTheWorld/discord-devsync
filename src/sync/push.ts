import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { resolve } from 'path';
import { tmpdir } from 'os';
import { MERGED_DIR, type ResolvedHost } from '../config.js';
import { info, success, warn } from '../log.js';
import { rsync, rsyncDelete, remotePath } from '../ssh.js';
import { pushDotfiles } from '../env/dotfiles.js';
import { pushSecrets } from '../env/secrets.js';
import { reconcileMcp } from '../env/mcp.js';

function pushClaudeContent(host: ResolvedHost): void {
  const claudeMd = resolve(MERGED_DIR, 'CLAUDE.md');
  if (!existsSync(claudeMd)) {
    warn('No merged CLAUDE.md — skipping', 'push');
    return;
  }

  // CLAUDE.md
  info(`  CLAUDE.md → ${host.name}:${host.paths.claude_md}`, 'push');
  const r = rsync(claudeMd, remotePath(host, host.paths.claude_md));
  if (r.ok) success(`  CLAUDE.md pushed to ${host.name}`, 'push');
  else warn(`  Failed to push CLAUDE.md to ${host.name}`, 'push');

  // KB directory (with --delete)
  const kbDir = resolve(MERGED_DIR, 'discord-kb');
  if (existsSync(kbDir)) {
    info(`  KB directory → ${host.name}:${host.paths.kb}`, 'push');
    const kr = rsyncDelete(kbDir + '/', remotePath(host, host.paths.kb + '/'));
    if (kr.ok) success(`  KB directory pushed to ${host.name}`, 'push');
    else warn(`  Failed to push KB directory to ${host.name}`, 'push');
  }

  // Skills (layer-filtered, with --delete)
  pushFilteredSkills(host);
}

function pushFilteredSkills(host: ResolvedHost): void {
  const mergedSkills = resolve(MERGED_DIR, '.claude', 'skills');
  if (!existsSync(mergedSkills)) return;

  const allSkills = readdirSync(mergedSkills, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  // Determine which skills this host gets
  const hostSkills =
    host.skills === 'all'
      ? allSkills
      : allSkills.filter((s) => (host.skills as Set<string>).has(s));

  // Build a temp directory with only the host's skills, then rsync --delete
  const tempDir = mkdtempSync(resolve(tmpdir(), 'devsync-skills-push-'));
  try {
    for (const skill of hostSkills) {
      const src = resolve(mergedSkills, skill);
      const dst = resolve(tempDir, skill);
      rsync(src + '/', dst + '/');
    }

    info(
      `  Skills (${hostSkills.length}/${allSkills.length}) → ${host.name}:${host.paths.skills}`,
      'push',
    );
    const r = rsyncDelete(tempDir + '/', remotePath(host, host.paths.skills + '/'));
    if (r.ok) success(`  Skills pushed to ${host.name}`, 'push');
    else warn(`  Failed to push skills to ${host.name}`, 'push');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function pushHost(host: ResolvedHost): void {
  info(`Pushing to ${host.name} (${host.hostname})`, 'push');

  pushClaudeContent(host);

  if (host.dotfiles) {
    pushDotfiles(host);
  }

  if (host.secrets) {
    pushSecrets(host);
  }

  if (host.mcp.size > 0) {
    reconcileMcp(host);
  }
}

export function push(hosts: ResolvedHost[]): void {
  info('Starting push...', 'sync');
  for (const host of hosts) {
    pushHost(host);
  }
  success('Push completed', 'sync');
}
