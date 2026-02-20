import { execFileSync } from 'child_process';
import ora from 'ora';
import { PROJECT_ROOT } from '../config.js';

export function commit(): void {
  console.log('\nCommit:');

  // Check if there's anything to commit first
  execFileSync('git', ['add', 'data/'], { cwd: PROJECT_ROOT, stdio: 'pipe' });

  try {
    const status = execFileSync('git', ['diff', '--cached', '--quiet'], {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
    });
    // If diff --cached --quiet exits 0, there's nothing staged
    ora({ prefixText: '  ' }).info('Nothing to commit');
  } catch {
    // Exit code 1 = there are staged changes
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    try {
      execFileSync('git', ['commit', '-m', `sync ${timestamp}`], {
        cwd: PROJECT_ROOT,
        stdio: 'pipe',
      });
      ora({ prefixText: '  ' }).succeed('Changes committed');
    } catch {
      ora({ prefixText: '  ' }).fail('Commit failed');
    }
  }
}
