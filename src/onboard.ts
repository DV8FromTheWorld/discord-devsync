import ora from 'ora';
import type { ResolvedHost } from './config.js';
import { error } from './log.js';
import { sshCheck, sshRun } from './ssh.js';
import { push } from './sync/push.js';

export function onboard(host: ResolvedHost): void {
  console.log();

  // 1. Verify SSH connectivity
  if (!host.isLocal) {
    const sshSpinner = ora({ text: `Checking SSH to ${host.hostname}`, prefixText: '  ' }).start();
    if (!sshCheck(host)) {
      sshSpinner.fail(`Cannot reach ${host.hostname} via SSH`);
      process.exit(1);
    }
    sshSpinner.succeed(`SSH to ${host.hostname}`);
  }

  // 2. Create directory structure
  const dirSpinner = ora({ text: 'Creating directories', prefixText: '  ' }).start();
  const dirs = [host.paths.kb, host.paths.skills, '~/.claude'];
  const mkdirCmd = dirs.map((d) => `mkdir -p ${d}`).join(' && ');
  const mkdirResult = sshRun(host, mkdirCmd);
  if (!mkdirResult.ok) {
    dirSpinner.fail('Failed to create directories');
    process.exit(1);
  }
  dirSpinner.succeed('Directories created');

  // 3. Push everything
  push([host]);

  console.log();
  ora().succeed(`Onboarded ${host.name}`);
  console.log();
  console.log(`  hostname:  ${host.hostname}`);
  console.log(`  platform:  ${host.platform}`);
  console.log(`  skills:    ${host.skills === 'all' ? 'all' : [...host.skills].join(', ')}`);
  console.log(`  mcp:       ${[...host.mcp].join(', ') || 'none'}`);
  console.log(`  dotfiles:  ${host.dotfiles ? 'yes' : 'no'}`);
  console.log(`  secrets:   ${host.secrets ? 'yes' : 'no'}`);
}
