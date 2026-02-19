import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { DOTFILES_DIR, type ResolvedHost } from '../config.js';
import { info, success, warn } from '../log.js';
import { rsync, remotePath, sshRun } from '../ssh.js';

const DEVSYNC_SOURCE_FILE = '.devsync.sh';

// Source lines for each shell's rc file
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

  // Check if the source line already exists in the rc file, add if not
  const checkCmd = `grep -qF '${config.line}' ~/${config.rc} 2>/dev/null || echo '${config.line}' >> ~/${config.rc}`;
  const result = sshRun(host, checkCmd);
  if (result.ok) {
    info(`    Ensured ~/${config.rc} sources ${DEVSYNC_SOURCE_FILE}`, 'dotfiles');
  } else {
    warn(`    Could not update ~/${config.rc}`, 'dotfiles');
  }
}

function assembleDotfile(filename: string, platform: string): string | null {
  const platformPath = resolve(DOTFILES_DIR, platform, filename);
  const basePath = resolve(DOTFILES_DIR, 'base', filename);

  if (existsSync(platformPath)) return readFileSync(platformPath, 'utf-8');
  if (existsSync(basePath)) return readFileSync(basePath, 'utf-8');
  return null;
}

export function pushDotfiles(host: ResolvedHost): void {
  info(`  Pushing dotfiles to ${host.name}`, 'dotfiles');

  const tempDir = mkdtempSync(resolve(tmpdir(), 'devsync-dotfiles-'));

  try {
    // Assemble and push ~/.devsync.sh (sourced by shell rc files)
    const devsyncSh = assembleDevsyncSh(host.platform);
    const devsyncShPath = resolve(tempDir, DEVSYNC_SOURCE_FILE);
    writeFileSync(devsyncShPath, devsyncSh);

    info(`    ${DEVSYNC_SOURCE_FILE} → ${host.name}:~/${DEVSYNC_SOURCE_FILE}`, 'dotfiles');
    const r = rsync(devsyncShPath, remotePath(host, `~/${DEVSYNC_SOURCE_FILE}`));
    if (r.ok) {
      success(`    ${DEVSYNC_SOURCE_FILE} pushed`, 'dotfiles');
    } else {
      warn(`    Failed to push ${DEVSYNC_SOURCE_FILE}`, 'dotfiles');
    }

    // Ensure shell rc files source our file (non-destructive — only appends if missing)
    ensureSourcedInRcFile(host, 'zsh');
    ensureSourcedInRcFile(host, 'bash');

    // Other dotfiles: simple base/platform overlay (e.g., .gitconfig)
    const baseDir = resolve(DOTFILES_DIR, 'base');
    const platformDir = resolve(DOTFILES_DIR, host.platform);

    const allDotfiles = new Set<string>();
    if (existsSync(baseDir)) {
      for (const f of readdirSync(baseDir)) {
        if (f.startsWith('.') && f !== '.gitkeep') {
          allDotfiles.add(f);
        }
      }
    }
    if (existsSync(platformDir)) {
      for (const f of readdirSync(platformDir)) {
        if (f.startsWith('.') && f !== '.gitkeep') {
          allDotfiles.add(f);
        }
      }
    }

    for (const dotfile of allDotfiles) {
      const content = assembleDotfile(dotfile, host.platform);
      if (!content) continue;

      const tmpFile = resolve(tempDir, dotfile);
      writeFileSync(tmpFile, content);
      info(`    ${dotfile} → ${host.name}:~/${dotfile}`, 'dotfiles');
      rsync(tmpFile, remotePath(host, `~/${dotfile}`));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
