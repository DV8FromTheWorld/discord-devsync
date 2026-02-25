import { existsSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { MERGED_DIR, DREAM_LOG_DIR, type ResolvedHost } from '../config.js';
import { info, success, warn } from '../log.js';
import { hostExec, checkConnection } from '../ssh.js';

const RETENTION_WEEKS = 4;

export async function cleanup(hosts: ResolvedHost[]): Promise<void> {
  info('Enforcing retention policy...');

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_WEEKS * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let deleted = 0;

  // Clean local journal entries (per-host subdirectories)
  const journalDir = resolve(MERGED_DIR, 'discord-kb', 'journal');
  if (existsSync(journalDir)) {
    for (const hostOrFile of readdirSync(journalDir, { withFileTypes: true })) {
      if (hostOrFile.isDirectory()) {
        // Per-host subdirectory
        const hostDir = resolve(journalDir, hostOrFile.name);
        for (const file of readdirSync(hostDir)) {
          const datePart = file.replace('.md', '');
          if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < cutoffStr) {
            info(`  Deleting old journal entry: ${hostOrFile.name}/${file}`);
            unlinkSync(resolve(hostDir, file));
            deleted++;
          }
        }
      } else if (hostOrFile.name.endsWith('.md')) {
        // Legacy flat file
        const datePart = hostOrFile.name.replace('.md', '');
        if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < cutoffStr) {
          info(`  Deleting old journal entry: ${hostOrFile.name}`);
          unlinkSync(resolve(journalDir, hostOrFile.name));
          deleted++;
        }
      }
    }
  }

  // Clean dream logs
  if (existsSync(DREAM_LOG_DIR)) {
    for (const file of readdirSync(DREAM_LOG_DIR)) {
      const datePart = file.replace('.md', '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < cutoffStr) {
        info(`  Deleting old dream log: ${file}`);
        unlinkSync(resolve(DREAM_LOG_DIR, file));
        deleted++;
      }
    }
  }

  // Clean remote journal entries
  for (const host of hosts) {
    if (host.isLocal) continue;

    const reachable = await checkConnection(host);
    if (!reachable) {
      warn(`  ${host.name}: unreachable, skipping remote journal cleanup`);
      continue;
    }

    const kbPath = host.paths.kb;
    const cmd = `find ${kbPath}/journal -name '*.md' -type f 2>/dev/null | while read f; do d=$(basename "$f" .md); [ "$d" \\< "${cutoffStr}" ] && rm "$f" && echo "deleted $f"; done`;
    const result = await hostExec(host, cmd);
    if (result.ok && result.stdout.trim()) {
      const lines = result.stdout.trim().split('\n').length;
      info(`  ${host.name}: deleted ${lines} old remote journal entries`);
      deleted += lines;
    }
  }

  if (deleted > 0) {
    success(`Cleaned up ${deleted} old files`);
  } else {
    info('No old files to clean up');
  }
}
