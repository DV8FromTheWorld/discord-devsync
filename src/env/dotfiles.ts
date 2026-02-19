import { existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { DOTFILES_DIR, type ResolvedHost } from '../config.js';
import { info, success, warn } from '../log.js';
import { rsync, remotePath } from '../ssh.js';

const MARKER_START = '# --- devsync managed (do not edit between markers) ---';
const MARKER_PLATFORM = (p: string) => `# --- devsync platform (${p}) ---`;
const MARKER_SECRETS = '# --- devsync secrets ---';
const MARKER_END = '# --- devsync end ---';

function readIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf-8') : null;
}

function assembleZshrc(platform: string): string {
  const parts: string[] = [MARKER_START];

  const base = readIfExists(resolve(DOTFILES_DIR, 'base', '.zshrc.base'));
  if (base) parts.push(base.trimEnd());

  const platformFile = readIfExists(resolve(DOTFILES_DIR, platform, '.zshrc.platform'));
  if (platformFile) {
    parts.push(MARKER_PLATFORM(platform));
    parts.push(platformFile.trimEnd());
  }

  parts.push(MARKER_SECRETS);
  parts.push('[ -f ~/.devsync-env ] && source ~/.devsync-env');
  parts.push(MARKER_END);

  return parts.join('\n') + '\n';
}

function assembleDotfile(filename: string, platform: string): string | null {
  // Try platform-specific first, then base
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
    // .zshrc gets special assembly treatment
    const zshrc = assembleZshrc(host.platform);
    const zshrcPath = resolve(tempDir, '.zshrc');
    writeFileSync(zshrcPath, zshrc);

    info(`    .zshrc → ${host.name}:~/.zshrc`, 'dotfiles');
    const r = rsync(zshrcPath, remotePath(host, '~/.zshrc'));
    if (r.ok) success(`    .zshrc pushed`, 'dotfiles');
    else warn(`    Failed to push .zshrc`, 'dotfiles');

    // Other dotfiles: simple base/platform overlay
    const baseDir = resolve(DOTFILES_DIR, 'base');
    const platformDir = resolve(DOTFILES_DIR, host.platform);

    const allDotfiles = new Set<string>();
    if (existsSync(baseDir)) {
      for (const f of readdirSync(baseDir)) {
        if (f.startsWith('.') && !f.endsWith('.base') && !f.endsWith('.platform')) {
          allDotfiles.add(f);
        }
      }
    }
    if (existsSync(platformDir)) {
      for (const f of readdirSync(platformDir)) {
        if (f.startsWith('.') && !f.endsWith('.base') && !f.endsWith('.platform')) {
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
