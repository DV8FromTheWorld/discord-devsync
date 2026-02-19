import { execFileSync, ExecFileSyncOptions } from 'child_process';
import type { ResolvedHost } from './config.js';

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], opts?: ExecFileSyncOptions): RunResult {
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

export function rsync(src: string, dst: string, flags: string[] = []): RunResult {
  return run('rsync', ['-av', ...flags, src, dst]);
}

export function rsyncDelete(src: string, dst: string): RunResult {
  return rsync(src, dst, ['--delete']);
}

export function sshRun(host: ResolvedHost, cmd: string): RunResult {
  if (host.isLocal) {
    return run('bash', ['-c', cmd]);
  }
  return run('ssh', [host.hostname, cmd]);
}

export function sshCheck(host: ResolvedHost): boolean {
  const result = sshRun(host, 'echo ok');
  return result.ok && result.stdout.trim() === 'ok';
}

export function remotePath(host: ResolvedHost, path: string): string {
  if (host.isLocal) return path;
  return `${host.hostname}:${path}`;
}
