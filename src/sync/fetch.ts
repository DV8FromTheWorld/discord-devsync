import { mkdirSync } from 'fs';
import { resolve } from 'path';
import ora from 'ora';
import { REMOTES_DIR, type ResolvedHost } from '../config.js';
import { rsyncAsync, rsyncDeleteAsync, remotePath } from '../ssh.js';

interface FetchResult {
  host: string;
  succeeded: string[];
  errors: string[];
}

async function fetchHost(host: ResolvedHost): Promise<FetchResult> {
  const result: FetchResult = { host: host.name, succeeded: [], errors: [] };
  const remoteDir = resolve(REMOTES_DIR, host.name);
  mkdirSync(remoteDir, { recursive: true });

  const claudeResult = await rsyncAsync(
    remotePath(host, host.paths.claude_md),
    resolve(remoteDir, 'CLAUDE.md'),
  );
  if (claudeResult.ok) result.succeeded.push('CLAUDE.md');
  else result.errors.push('CLAUDE.md: not found or host unreachable');

  const kbDir = resolve(remoteDir, 'discord-kb');
  mkdirSync(kbDir, { recursive: true });
  const kbResult = await rsyncDeleteAsync(remotePath(host, host.paths.kb + '/'), kbDir + '/');
  if (kbResult.ok) result.succeeded.push('KB');
  else result.errors.push('KB: directory not found');

  const skillsDir = resolve(remoteDir, '.claude', 'skills');
  mkdirSync(skillsDir, { recursive: true });
  const skillsResult = await rsyncDeleteAsync(
    remotePath(host, host.paths.skills + '/'),
    skillsDir + '/',
  );
  if (skillsResult.ok) result.succeeded.push('skills');
  else result.errors.push('Skills: directory not found');

  return result;
}

function printResult(r: FetchResult): void {
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

  // Start all fetches in parallel with individual spinners
  const spinners = hosts.map((host) => ({
    host,
    spinner: ora({ text: host.name, prefixText: '  ' }).start(),
    promise: fetchHost(host),
  }));

  // Collect results, then print sequentially for clean output
  const completed: { spinner: ReturnType<typeof ora>; result: FetchResult }[] = [];
  await Promise.all(
    spinners.map(async ({ spinner, promise }) => {
      const result = await promise;
      spinner.stop();
      completed.push({ spinner, result });
    }),
  );

  // Print in original host order
  for (const { result } of completed.sort(
    (a, b) =>
      hosts.findIndex((h) => h.name === a.result.host) -
      hosts.findIndex((h) => h.name === b.result.host),
  )) {
    printResult(result);
  }

  const succeeded = completed.filter((c) => c.result.errors.length === 0).length;
  const partial = completed.filter(
    (c) => c.result.errors.length > 0 && c.result.succeeded.length > 0,
  ).length;
  const failed = completed.filter(
    (c) => c.result.succeeded.length === 0 && c.result.errors.length > 0,
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
