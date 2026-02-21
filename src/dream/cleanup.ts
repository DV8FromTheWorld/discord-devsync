import { existsSync, readdirSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { MERGED_DIR, DREAM_LOG_DIR, type ResolvedHost } from '../config.js';
import { hostExec, checkConnection } from '../ssh.js';
import { info, success, warn } from '../log.js';

const RETENTION_WEEKS = 4;

export async function cleanup(hosts: ResolvedHost[]): Promise<void> {
  info('Enforcing retention policy...');

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_WEEKS * 7);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  let deleted = 0;

  // Clean local merged journal entries (per-host subdirectories)
  const journalDir = resolve(MERGED_DIR, 'discord-kb', 'journal');
  if (existsSync(journalDir)) {
    for (const hostDir of readdirSync(journalDir, { withFileTypes: true })) {
      if (!hostDir.isDirectory()) continue;
      const hostJournalDir = resolve(journalDir, hostDir.name);
      for (const file of readdirSync(hostJournalDir)) {
        const datePart = file.replace('.md', '');
        if (/^\d{4}-\d{2}-\d{2}$/.test(datePart) && datePart < cutoffStr) {
          info(`  Deleting old local journal: ${hostDir.name}/${file}`);
          unlinkSync(resolve(hostJournalDir, file));
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

  // Delete old journal entries on remotes via SSH
  for (const host of hosts) {
    if (host.isLocal) continue;

    const reachable = await checkConnection(host);
    if (!reachable) {
      warn(`  ${host.name}: unreachable, skipping remote journal cleanup`);
      continue;
    }

    // Find and delete old journal files on the remote
    const cmd = `find ${host.paths.kb}/journal -maxdepth 1 -name '*.md' 2>/dev/null | while read f; do
  d=$(basename "$f" .md)
  if echo "$d" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' && [ "$d" '<' "${cutoffStr}" ]; then
    rm "$f" && echo "deleted $d"
  fi
done`;

    const result = await hostExec(host, cmd);
    if (result.ok && result.stdout.trim()) {
      const lines = result.stdout.trim().split('\n');
      info(`  ${host.name}: deleted ${lines.length} old remote journal entries`);
      deleted += lines.length;
    }
  }

  if (deleted > 0) {
    success(`Cleaned up ${deleted} old files`);
  } else {
    info('No old files to clean up');
  }
}
