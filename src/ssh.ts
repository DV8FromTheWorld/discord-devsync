import { execFile } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { homedir, tmpdir } from 'os';
import { resolve } from 'path';
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
const CONNECT_CHECK_TIMEOUT = 15_000;
const SSH_CONNECT_TIMEOUT = 10;

// --- SSH connection multiplexing ---

let muxDir: string | null = null;

function getMuxDir(): string {
  if (!muxDir) {
    muxDir = mkdtempSync(resolve(tmpdir(), 'devsync-ssh-'));
  }
  return muxDir;
}

function muxSocketPath(hostname: string): string {
  return resolve(getMuxDir(), hostname);
}

function sshOpts(hostname?: string): string[] {
  const opts = ['-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`];
  if (hostname) {
    const socket = muxSocketPath(hostname);
    opts.push('-o', `ControlMaster=auto`, '-o', `ControlPath=${socket}`, '-o', `ControlPersist=60`);
  }
  return opts;
}

function sshOptsString(hostname?: string): string {
  return sshOpts(hostname)
    .reduce((acc: string[], opt, i, arr) => {
      if (opt === '-o' && i + 1 < arr.length) {
        acc.push(`-o ${arr[i + 1]}`);
      }
      return acc;
    }, [])
    .join(' ');
}

export function cleanupMux(): void {
  if (muxDir) {
    rmSync(muxDir, { recursive: true, force: true });
    muxDir = null;
  }
}

// --- Exec ---

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
  return exec('ssh', [...sshOpts(host.hostname), host.hostname, cmd]);
}

// --- Connectivity check ---

export async function checkConnection(host: ResolvedHost): Promise<boolean> {
  if (host.isLocal) return true;
  const result = await exec(
    'ssh',
    [...sshOpts(host.hostname), host.hostname, 'echo ok'],
    CONNECT_CHECK_TIMEOUT,
  );
  return result.ok && result.stdout.trim() === 'ok';
}

// --- Rsync ---

export function rsync(src: string, dst: string, flags: string[] = []): Promise<RunResult> {
  // Extract hostname from rsync src/dst (format: "hostname:path")
  const remoteMatch = src.match(/^([^:]+):/) ?? dst.match(/^([^:]+):/);
  const hostname = remoteMatch?.[1];
  return exec('rsync', ['-av', '-e', `ssh ${sshOptsString(hostname)}`, ...flags, src, dst]);
}

export function rsyncMirror(src: string, dst: string): Promise<RunResult> {
  return rsync(src, dst, ['--delete']);
}

// --- Remote JSON file helpers ---

export async function readRemoteJson(
  host: ResolvedHost,
  remotePath_: string,
): Promise<Record<string, unknown>> {
  const result = await hostExec(host, `cat ${remotePath_} 2>/dev/null || echo "{}"`);
  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    return {};
  }
}

export async function writeRemoteJson(
  host: ResolvedHost,
  remotePath_: string,
  data: Record<string, unknown>,
): Promise<void> {
  const json = JSON.stringify(data, null, 2) + '\n';
  const b64 = Buffer.from(json).toString('base64');
  await hostExec(
    host,
    `printf '%s' '${b64}' | base64 -d > ${remotePath_}.tmp && mv ${remotePath_}.tmp ${remotePath_}`,
  );
}

// --- Path helpers ---

export function remotePath(host: ResolvedHost, path: string): string {
  if (host.isLocal) return expandHome(path);
  return `${host.hostname}:${path}`;
}
