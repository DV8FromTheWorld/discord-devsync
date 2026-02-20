import { existsSync } from 'fs';
import ora from 'ora';
import { REMOTES_DIR } from '../config.js';
import { debug } from '../log.js';
import { mergeClaudeMd } from './merge-claude.js';
import { mergeKbDirectories } from './merge-kb.js';
import { mergeSkillsDirectories } from './merge-skills.js';
import { mergeMcpServers } from './merge-mcp.js';
import { mergePermissions } from './merge-permissions.js';
import { collectJournalEntries } from './collect-journal.js';

export async function merge(): Promise<void> {
  if (!existsSync(REMOTES_DIR)) {
    debug('No remotes/ directory found. Merging with existing state only.');
  }

  console.log('\nMerge:');
  const spinner = ora({ text: 'Merging...', prefixText: '  ' }).start();

  const parts: string[] = [];

  const claudeResult = mergeClaudeMd();
  if (claudeResult) parts.push(claudeResult);

  const kbResult = mergeKbDirectories();
  if (kbResult) parts.push(kbResult);

  const journalResult = collectJournalEntries();
  if (journalResult) parts.push(journalResult);

  const skillsResult = await mergeSkillsDirectories();
  if (skillsResult) parts.push(skillsResult);

  const mcpResult = mergeMcpServers();
  if (mcpResult.summary) parts.push(mcpResult.summary);

  const permResult = mergePermissions();
  if (permResult) parts.push(permResult);

  spinner.stop();

  // Print MCP discovery warnings before the summary
  if (mcpResult.warnings.length > 0) {
    for (const w of mcpResult.warnings) {
      ora({ prefixText: '  ' }).warn(w);
    }
  }

  const summary = parts.length > 0 ? parts.join(', ') : 'no changes';
  ora({ prefixText: '  ' }).succeed(`Merge complete (${summary})`);
}
