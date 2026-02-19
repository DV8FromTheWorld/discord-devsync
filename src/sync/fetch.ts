import { mkdirSync } from 'fs';
import { resolve } from 'path';
import ora from 'ora';
import { REMOTES_DIR, type ResolvedHost } from '../config.js';
import { rsync, rsyncMirror, remotePath, checkConnection } from '../ssh.js';

interface FetchResult {
  host: string;
  succeeded: string[];
  errors: string[];
  unreachable: boolean;
}

async function fetchHost(host: ResolvedHost): Promise<FetchResult> {
  const result: FetchResult = { host: host.name, succeeded: [], errors: [], unreachable: false };

  // Check connectivity first (skip for localhost)
  if (!host.isLocal) {
    const reachable = await checkConnection(host);
    if (!reachable) {
      result.unreachable = true;
      result.errors.push('host unreachable');
      return result;
    }
  }

  const remoteDir = resolve(REMOTES_DIR, host.name);
  mkdirSync(remoteDir, { recursive: true });

  // CLAUDE.md (single file copy)
  const claudeResult = await rsync(
    remotePath(host, host.paths.claude_md),
    resolve(remoteDir, 'CLAUDE.md'),
  );
  if (claudeResult.ok) result.succeeded.push('CLAUDE.md');
  else result.errors.push('CLAUDE.md not found');

  // KB directory (mirror with --delete so local copy matches remote exactly)
  const kbDir = resolve(remoteDir, 'discord-kb');
  mkdirSync(kbDir, { recursive: true });
  const kbResult = await rsyncMirror(remotePath(host, host.paths.kb + '/'), kbDir + '/');
  if (kbResult.ok) result.succeeded.push('KB');
  else result.errors.push('KB directory not found');

  // Skills directory (mirror with --delete)
  const skillsDir = resolve(remoteDir, '.claude', 'skills');
  mkdirSync(skillsDir, { recursive: true });
  const skillsResult = await rsyncMirror(
    remotePath(host, host.paths.skills + '/'),
    skillsDir + '/',
  );
  if (skillsResult.ok) result.succeeded.push('skills');
  else result.errors.push('skills directory not found');

  return result;
}

function printResult(r: FetchResult): void {
  if (r.unreachable) {
    ora({ prefixText: '  ' }).fail(`${r.host} — unreachable`);
    return;
  }

  if (r.errors.length === 0) {
    ora({ prefixText: '  ' }).succeed(`${r.host} — ${r.succeeded.join(', ')}`);
  } else if (r.succeeded.length > 0) {
    ora({ prefixText: '  ' }).warn(r.host);
    console.log(`        ${r.succeeded.join(', ')}`);
    for (const err of r.errors) {
      console.log(`      \x1b[31m✖\x1b[0m ${err}`);
    }
  } else {
    ora({ prefixText: '  ' }).fail(r.host);
    for (const err of r.errors) {
      console.log(`      \x1b[31m✖\x1b[0m ${err}`);
    }
  }
}

export async function fetch(hosts: ResolvedHost[]): Promise<void> {
  if (hosts.length === 0) {
    console.log('No hosts configured.');
    return;
  }

  console.log();

  const total = hosts.length;
  let completed = 0;
  let errorCount = 0;

  const spinner = ora({ prefixText: '  ' });

  function updateSpinner(): void {
    const errStr = errorCount > 0 ? `, ${errorCount} with errors` : '';
    spinner.text = `${completed}/${total} complete${errStr}`;
  }

  updateSpinner();
  spinner.start();

  const results: FetchResult[] = [];
  await Promise.all(
    hosts.map(async (host) => {
      const result = await fetchHost(host);
      completed++;
      if (result.errors.length > 0) errorCount++;
      results.push(result);
      updateSpinner();
    }),
  );

  spinner.stop();

  // Print in original host order
  const ordered = hosts.map((h) => results.find((r) => r.host === h.name)!);
  for (const result of ordered) {
    printResult(result);
  }

  const succeeded = ordered.filter((r) => r.errors.length === 0).length;
  const partial = ordered.filter(
    (r) => !r.unreachable && r.errors.length > 0 && r.succeeded.length > 0,
  ).length;
  const failed = ordered.filter(
    (r) => r.unreachable || (r.succeeded.length === 0 && r.errors.length > 0),
  ).length;

  console.log();
  const summary = [
    `${succeeded} ok`,
    partial > 0 ? `${partial} partial` : '',
    failed > 0 ? `${failed} failed` : '',
  ]
    .filter(Boolean)
    .join(', ');
  ora().succeed(`Fetch complete (${summary})`);
}
