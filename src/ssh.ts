import { execFile } from 'child_process';
import { homedir } from 'os';
import type { ResolvedHost } from './config.js';

function expandHome(path: string): string {
  return path.replace(/^~(?=$|\/)/, homedir());
}

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

const DEFAULT_TIMEOUT = 30_000;
const CONNECT_CHECK_TIMEOUT = 10_000;

function exec(cmd: string, args: string[], timeout = DEFAULT_TIMEOUT): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout },
      (err, stdout, stderr) => {
        if (err) {
          const timedOut = (err as NodeJS.ErrnoException & { killed?: boolean }).killed;
          resolve({
            ok: false,
            stdout: stdout ?? '',
            stderr: timedOut ? 'timed out' : (stderr ?? ''),
          });
        } else {
          resolve({ ok: true, stdout: stdout ?? '', stderr: stderr ?? '' });
        }
      },
    );
  });
}

// --- Host command execution ---

export function hostExec(host: ResolvedHost, cmd: string): Promise<RunResult> {
  if (host.isLocal) {
    return exec('bash', ['-c', cmd]);
  }
  return exec('ssh', [host.hostname, cmd]);
}

// --- Connectivity check ---

export async function checkConnection(host: ResolvedHost): Promise<boolean> {
  if (host.isLocal) return true;
  const result = await exec(
    'ssh',
    ['-o', 'ConnectTimeout=10', host.hostname, 'echo ok'],
    CONNECT_CHECK_TIMEOUT,
  );
  return result.ok && result.stdout.trim() === 'ok';
}

// --- Rsync ---

export function rsync(src: string, dst: string, flags: string[] = []): Promise<RunResult> {
  return exec('rsync', ['-av', ...flags, src, dst]);
}

export function rsyncMirror(src: string, dst: string): Promise<RunResult> {
  return rsync(src, dst, ['--delete']);
}

// --- Path helpers ---

export function remotePath(host: ResolvedHost, path: string): string {
  if (host.isLocal) return expandHome(path);
  return `${host.hostname}:${path}`;
}
