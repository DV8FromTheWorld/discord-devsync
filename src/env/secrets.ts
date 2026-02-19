import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { SECRETS_DIR, type ResolvedHost } from '../config.js';
import { rsync, remotePath } from '../ssh.js';

const ENV_FILE = 'env';
const REMOTE_ENV_PATH = '.devsync-env';

export function pushSecrets(host: ResolvedHost): void {
  const envFile = resolve(SECRETS_DIR, ENV_FILE);
  if (!existsSync(envFile)) return;
  rsync(envFile, remotePath(host, `~/${REMOTE_ENV_PATH}`));
}

export function loadSecrets(): Record<string, string> {
  const envFile = resolve(SECRETS_DIR, ENV_FILE);
  if (!existsSync(envFile)) return {};

  const content = readFileSync(envFile, 'utf-8');
  const vars: Record<string, string> = {};

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    vars[trimmed.slice(0, eqIdx)] = trimmed.slice(eqIdx + 1);
  }

  return vars;
}
