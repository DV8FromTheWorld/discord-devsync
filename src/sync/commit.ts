import { execFileSync } from 'child_process';
import { PROJECT_ROOT } from '../config.js';
import { info, success, warn } from '../log.js';

export function commit(): void {
  info('Committing changes to git...', 'sync');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  try {
    execFileSync('git', ['add', '-A'], { cwd: PROJECT_ROOT, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', `sync ${timestamp}`], {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
    });
    success('Changes committed', 'sync');
  } catch {
    warn('Nothing to commit or git error', 'sync');
  }
}
