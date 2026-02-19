import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, type ResolvedHost } from '../config.js';
import { info, success, warn } from '../log.js';
import { rsync, rsyncDelete, remotePath } from '../ssh.js';

function fetchHost(host: ResolvedHost): void {
  info(`Fetching from ${host.hostname}`, 'fetch');
  const remoteDir = resolve(REMOTES_DIR, host.name);
  mkdirSync(remoteDir, { recursive: true });

  // CLAUDE.md (single file, no --delete)
  info(`  CLAUDE.md from ${host.hostname}:${host.paths.claude_md}`, 'fetch');
  const claudeResult = rsync(
    remotePath(host, host.paths.claude_md),
    resolve(remoteDir, 'CLAUDE.md'),
  );
  if (claudeResult.ok) {
    success(`  CLAUDE.md fetched from ${host.name}`, 'fetch');
  } else {
    warn(`  Failed to fetch CLAUDE.md from ${host.name}`, 'fetch');
  }

  // KB directory (with --delete to mirror remote)
  info(`  KB directory from ${host.hostname}:${host.paths.kb}`, 'fetch');
  const kbDir = resolve(remoteDir, 'discord-kb');
  mkdirSync(kbDir, { recursive: true });
  const kbResult = rsyncDelete(remotePath(host, host.paths.kb + '/'), kbDir + '/');
  if (kbResult.ok) {
    success(`  KB directory fetched from ${host.name}`, 'fetch');
  } else {
    warn(`  Failed to fetch KB directory from ${host.name}`, 'fetch');
  }

  // Skills directory (with --delete to mirror remote)
  info(`  Skills directory from ${host.hostname}:${host.paths.skills}`, 'fetch');
  const skillsDir = resolve(remoteDir, '.claude', 'skills');
  mkdirSync(skillsDir, { recursive: true });
  const skillsResult = rsyncDelete(remotePath(host, host.paths.skills + '/'), skillsDir + '/');
  if (skillsResult.ok) {
    success(`  Skills directory fetched from ${host.name}`, 'fetch');
  } else {
    warn(`  Failed to fetch skills directory from ${host.name}`, 'fetch');
  }
}

export function fetch(hosts: ResolvedHost[]): void {
  info('Starting fetch...', 'sync');
  for (const host of hosts) {
    fetchHost(host);
  }
  success('Fetch completed', 'sync');
}
