import type { ResolvedHost } from './config.js';
import { info, success, error } from './log.js';
import { sshCheck, sshRun } from './ssh.js';
import { push } from './sync/push.js';

export function onboard(host: ResolvedHost): void {
  info(`Onboarding ${host.name} (${host.hostname})...`, 'onboard');

  // 1. Verify SSH connectivity
  if (!host.isLocal) {
    info('  Checking SSH connectivity...', 'onboard');
    if (!sshCheck(host)) {
      error(`  Cannot reach ${host.hostname} via SSH`, 'onboard');
      process.exit(1);
    }
    success('  SSH connection OK', 'onboard');
  }

  // 2. Create directory structure
  info('  Creating directory structure...', 'onboard');
  const dirs = [host.paths.kb, host.paths.skills, '~/.claude'];
  const mkdirCmd = dirs.map((d) => `mkdir -p ${d}`).join(' && ');
  const mkdirResult = sshRun(host, mkdirCmd);
  if (!mkdirResult.ok) {
    error('  Failed to create directories', 'onboard');
    process.exit(1);
  }
  success('  Directories created', 'onboard');

  // 3. Push everything
  info('  Pushing all content...', 'onboard');
  push([host]);

  success(`Onboarding of ${host.name} completed!`, 'onboard');
  console.log();
  console.log(`  Host: ${host.hostname}`);
  console.log(`  Platform: ${host.platform}`);
  console.log(`  Skills: ${host.skills === 'all' ? 'all' : [...host.skills].join(', ')}`);
  console.log(`  MCP servers: ${[...host.mcp].join(', ') || 'none'}`);
  console.log(`  Dotfiles: ${host.dotfiles ? 'yes' : 'no'}`);
  console.log(`  Secrets: ${host.secrets ? 'yes' : 'no'}`);
}
