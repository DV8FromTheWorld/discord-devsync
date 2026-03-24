import { execFileSync } from 'child_process';
import { createInterface } from 'readline';
import ora from 'ora';
import { DATA_DIR, saveConfig, type Config } from '../config.js';

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

// ─── Git push ───────────────────────────────────────────────────

function countUnpushed(): number | null {
  try {
    const result = execFileSync('git', ['rev-list', '--count', '@{u}..HEAD'], {
      cwd: DATA_DIR,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return null; // no upstream / remote configured
  }
}

function gitPush(): boolean {
  try {
    execFileSync('git', ['push'], {
      cwd: DATA_DIR,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function doPush(count: number): void {
  if (gitPush()) {
    ora({ prefixText: '  ' }).succeed(`Pushed to remote (${count} commits)`);
  } else {
    ora({ prefixText: '  ' }).fail('Push to remote failed');
  }
}

export async function maybePush(config: Config, forcePush: boolean): Promise<void> {
  const count = countUnpushed();
  if (count === null) {
    ora({ prefixText: '  ' }).warn('No git remote configured — commits are local only');
    return;
  }
  if (count === 0) return;

  const autoPush = config.auto_push ?? 'ask';

  if (forcePush || autoPush === 'always') {
    doPush(count);
    return;
  }

  if (autoPush === 'never') {
    ora({ prefixText: '  ' }).info(`${count} unpushed commits (auto-push disabled)`);
    return;
  }

  // auto_push === 'ask'
  const noun = count === 1 ? 'commit' : 'commits';
  const answer = await ask(`  ${count} unpushed ${noun} — push? [Y/n/always/never]: `);
  const choice = answer.toLowerCase();

  if (choice === 'always') {
    config.auto_push = 'always';
    saveConfig(config);
    doPush(count);
  } else if (choice === 'never') {
    config.auto_push = 'never';
    saveConfig(config);
    ora({ prefixText: '  ' }).info(
      'Auto-push disabled. Change auto_push in config.yaml to re-enable.',
    );
  } else if (choice === '' || choice === 'y' || choice === 'yes') {
    doPush(count);
  }
  // else: 'n' or anything else = skip
}
