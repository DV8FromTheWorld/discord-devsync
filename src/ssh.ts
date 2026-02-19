import { execFile, execFileSync, ExecFileSyncOptions } from 'child_process';
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

function runSync(cmd: string, args: string[], opts?: ExecFileSyncOptions): RunResult {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
      ...opts,
    });
    return { ok: true, stdout: String(stdout), stderr: '' };
  } catch (e: unknown) {
    const err = e as { stdout?: string; stderr?: string };
    return { ok: false, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

function runAsync(cmd: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, stdout: stdout ?? '', stderr: stderr ?? '' });
        } else {
          resolve({ ok: true, stdout: stdout ?? '', stderr: stderr ?? '' });
        }
      },
    );
  });
}

export function rsync(src: string, dst: string, flags: string[] = []): RunResult {
  return runSync('rsync', ['-av', ...flags, src, dst]);
}

export function rsyncAsync(src: string, dst: string, flags: string[] = []): Promise<RunResult> {
  return runAsync('rsync', ['-av', ...flags, src, dst]);
}

export function rsyncDelete(src: string, dst: string): RunResult {
  return rsync(src, dst, ['--delete']);
}

export function rsyncDeleteAsync(src: string, dst: string): Promise<RunResult> {
  return rsyncAsync(src, dst, ['--delete']);
}

export function sshRun(host: ResolvedHost, cmd: string): RunResult {
  if (host.isLocal) {
    return runSync('bash', ['-c', cmd]);
  }
  return runSync('ssh', [host.hostname, cmd]);
}

export function sshRunAsync(host: ResolvedHost, cmd: string): Promise<RunResult> {
  if (host.isLocal) {
    return runAsync('bash', ['-c', cmd]);
  }
  return runAsync('ssh', [host.hostname, cmd]);
}

export function sshCheck(host: ResolvedHost): boolean {
  const result = sshRun(host, 'echo ok');
  return result.ok && result.stdout.trim() === 'ok';
}

export function remotePath(host: ResolvedHost, path: string): string {
  if (host.isLocal) return expandHome(path);
  return `${host.hostname}:${path}`;
}
