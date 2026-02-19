import { mkdirSync } from 'fs';
import { resolve } from 'path';
import ora from 'ora';
import { REMOTES_DIR, type ResolvedHost } from '../config.js';
import { rsyncAsync, rsyncDeleteAsync, remotePath } from '../ssh.js';

interface FetchResult {
  host: string;
  claude: boolean;
  kb: boolean;
  skills: boolean;
  errors: string[];
}

async function fetchHost(host: ResolvedHost): Promise<FetchResult> {
  const result: FetchResult = {
    host: host.name,
    claude: false,
    kb: false,
    skills: false,
    errors: [],
  };
  const remoteDir = resolve(REMOTES_DIR, host.name);
  mkdirSync(remoteDir, { recursive: true });

  // CLAUDE.md
  const claudeResult = await rsyncAsync(
    remotePath(host, host.paths.claude_md),
    resolve(remoteDir, 'CLAUDE.md'),
  );
  if (claudeResult.ok) {
    result.claude = true;
  } else {
    result.errors.push(`CLAUDE.md: not found or host unreachable`);
  }

  // KB directory
  const kbDir = resolve(remoteDir, 'discord-kb');
  mkdirSync(kbDir, { recursive: true });
  const kbResult = await rsyncDeleteAsync(remotePath(host, host.paths.kb + '/'), kbDir + '/');
  if (kbResult.ok) {
    result.kb = true;
  } else {
    result.errors.push(`KB: directory not found`);
  }

  // Skills directory
  const skillsDir = resolve(remoteDir, '.claude', 'skills');
  mkdirSync(skillsDir, { recursive: true });
  const skillsResult = await rsyncDeleteAsync(
    remotePath(host, host.paths.skills + '/'),
    skillsDir + '/',
  );
  if (skillsResult.ok) {
    result.skills = true;
  } else {
    result.errors.push(`Skills: directory not found`);
  }

  return result;
}

function formatResult(r: FetchResult): string {
  const items = [];
  if (r.claude) items.push('CLAUDE.md');
  if (r.kb) items.push('KB');
  if (r.skills) items.push('skills');
  return items.length > 0 ? items.join(', ') : 'nothing';
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
    spinner: ora({ text: `${host.name}`, prefixText: '  ' }).start(),
    promise: fetchHost(host),
  }));

  // Await all and update spinners
  const results = await Promise.all(
    spinners.map(async ({ host, spinner, promise }) => {
      const result = await promise;
      if (result.errors.length === 0) {
        spinner.succeed(`${host.name} — ${formatResult(result)}`);
      } else if (result.claude || result.kb || result.skills) {
        spinner.warn(`${host.name} — ${formatResult(result)} (${result.errors.join('; ')})`);
      } else {
        spinner.fail(`${host.name} — ${result.errors.join('; ')}`);
      }
      return result;
    }),
  );

  const succeeded = results.filter((r) => r.errors.length === 0).length;
  const partial = results.filter(
    (r) => r.errors.length > 0 && (r.claude || r.kb || r.skills),
  ).length;
  const failed = results.filter((r) => !r.claude && !r.kb && !r.skills).length;

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
