import { existsSync } from 'fs';
import ora from 'ora';
import { REMOTES_DIR } from '../config.js';
import { debug } from '../log.js';
import { mergeUserClaudeMd, mergeClaudeLocalMd } from './merge-claude.js';
import { migrateFromSingleClaudeMd } from './migrate-claude.js';
import { mergeKbDirectories } from './merge-kb.js';
import { mergeSkillsDirectories } from './merge-skills.js';
import { mergeMcpServers } from './merge-mcp.js';
import { mergeAgents } from './merge-agents.js';
import { mergePlugins } from './merge-plugins.js';
import { mergePermissions } from './merge-permissions.js';
import { collectJournalEntries } from './collect-journal.js';
import { type ContentChange, printMergeStepResult } from './changes.js';

async function mergeStep(
  label: string,
  fn: () => ContentChange | null | Promise<ContentChange | null>,
): Promise<ContentChange> {
  const spinner = ora({ text: `${label}...`, prefixText: '  ' }).start();
  const result = (await fn()) ?? { label };
  printMergeStepResult(spinner, result);
  return result;
}

export async function merge(): Promise<void> {
  if (!existsSync(REMOTES_DIR)) {
    debug('No remotes/ directory found. Merging with existing state only.');
  }

  console.log('\nMerge:');

  migrateFromSingleClaudeMd();

  let hasChanges = false;
  function track(change: ContentChange): void {
    if ((change.files && change.files.length > 0) || change.summary) hasChanges = true;
  }

  track(await mergeStep('user CLAUDE.md', mergeUserClaudeMd));
  track(await mergeStep('CLAUDE.local.md', mergeClaudeLocalMd));
  track(await mergeStep('knowledge base', mergeKbDirectories));
  track(await mergeStep('journal entries', collectJournalEntries));
  track(await mergeStep('skills', mergeSkillsDirectories));
  track(await mergeStep('agents', mergeAgents));

  // MCP has extra warnings to surface
  const mcpResult = await mergeStep('MCP servers', () => {
    const r = mergeMcpServers();
    if (r.warnings.length > 0) {
      for (const w of r.warnings) {
        ora({ prefixText: '  ' }).warn(w);
      }
    }
    return r.changes;
  });
  track(mcpResult);

  track(await mergeStep('plugins', mergePlugins));
  track(await mergeStep('permissions', mergePermissions));

  console.log();
  const label = hasChanges ? 'Merge complete' : 'Merge complete — no changes';
  ora({ prefixText: '  ' }).succeed(label);
}
