import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { DOTFILES_DIR, type ResolvedHost } from '../config.js';
import { rsync, remotePath, sshRun } from '../ssh.js';

const DEVSYNC_SOURCE_FILE = '.devsync.sh';

const SOURCE_LINES: Record<string, { rc: string; line: string }> = {
  zsh: {
    rc: '.zshrc',
    line: '[ -f ~/.devsync.sh ] && source ~/.devsync.sh',
  },
  bash: {
    rc: '.bashrc',
    line: '[ -f ~/.devsync.sh ] && source ~/.devsync.sh',
  },
  fish: {
    rc: '.config/fish/config.fish',
    line: 'test -f ~/.devsync.sh; and source ~/.devsync.sh',
  },
};

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

function assembleDevsyncSh(platform: string): string {
  const parts: string[] = ['# Managed by devsync — do not edit manually'];

  const base = readIfExists(resolve(DOTFILES_DIR, 'base', 'shell.sh'));
  if (base) parts.push(base.trimEnd());

  const platformFile = readIfExists(resolve(DOTFILES_DIR, platform, 'shell.sh'));
  if (platformFile) {
    parts.push(`# platform: ${platform}`);
    parts.push(platformFile.trimEnd());
  }

  parts.push('');
  parts.push('# secrets');
  parts.push('[ -f ~/.devsync-env ] && source ~/.devsync-env');

  return parts.join('\n') + '\n';
}

function ensureSourcedInRcFile(host: ResolvedHost, shell: string): void {
  const config = SOURCE_LINES[shell];
  if (!config) return;
  sshRun(
    host,
    `grep -qF '${config.line}' ~/${config.rc} 2>/dev/null || echo '${config.line}' >> ~/${config.rc}`,
  );
}

function assembleDotfile(filename: string, platform: string): string | null {
  const platformPath = resolve(DOTFILES_DIR, platform, filename);
  const basePath = resolve(DOTFILES_DIR, 'base', filename);
  if (existsSync(platformPath)) return readFileSync(platformPath, 'utf-8');
  if (existsSync(basePath)) return readFileSync(basePath, 'utf-8');
  return null;
}

export function pushDotfiles(host: ResolvedHost): void {
  const tempDir = mkdtempSync(resolve(tmpdir(), 'devsync-dotfiles-'));

  try {
    const devsyncSh = assembleDevsyncSh(host.platform);
    writeFileSync(resolve(tempDir, DEVSYNC_SOURCE_FILE), devsyncSh);
    rsync(resolve(tempDir, DEVSYNC_SOURCE_FILE), remotePath(host, `~/${DEVSYNC_SOURCE_FILE}`));

    ensureSourcedInRcFile(host, 'zsh');
    ensureSourcedInRcFile(host, 'bash');

    const baseDir = resolve(DOTFILES_DIR, 'base');
    const platformDir = resolve(DOTFILES_DIR, host.platform);

    const allDotfiles = new Set<string>();
    if (existsSync(baseDir)) {
      for (const f of readdirSync(baseDir)) {
        if (f.startsWith('.') && f !== '.gitkeep') allDotfiles.add(f);
      }
    }
    if (existsSync(platformDir)) {
      for (const f of readdirSync(platformDir)) {
        if (f.startsWith('.') && f !== '.gitkeep') allDotfiles.add(f);
      }
    }

    for (const dotfile of allDotfiles) {
      const content = assembleDotfile(dotfile, host.platform);
      if (!content) continue;
      const tmpFile = resolve(tempDir, dotfile);
      writeFileSync(tmpFile, content);
      rsync(tmpFile, remotePath(host, `~/${dotfile}`));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
