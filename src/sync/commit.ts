import { execFileSync } from 'child_process';
import ora from 'ora';
import { DATA_DIR } from '../config.js';

export function commit(): void {
  console.log('\nCommit:');

  // Stage only tracked data subdirectories (remotes/ and secrets/ are gitignored)
  execFileSync('git', ['add', 'config.yaml', 'merged/', 'dotfiles/', 'dream_log/', '.gitignore'], {
    cwd: DATA_DIR,
    stdio: 'pipe',
  });

  try {
    execFileSync('git', ['diff', '--cached', '--quiet'], {
      cwd: DATA_DIR,
      stdio: 'pipe',
    });
    // If diff --cached --quiet exits 0, there's nothing staged
    ora({ prefixText: '  ' }).info('Nothing to commit');
  } catch {
    // Exit code 1 = there are staged changes
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    try {
      execFileSync('git', ['commit', '-m', `sync ${timestamp}`], {
        cwd: DATA_DIR,
        stdio: 'pipe',
      });
      ora({ prefixText: '  ' }).succeed('Changes committed');
    } catch {
      ora({ prefixText: '  ' }).fail('Commit failed');
    }
  }
}
