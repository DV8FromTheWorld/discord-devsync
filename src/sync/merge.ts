import { existsSync } from 'fs';
import ora from 'ora';
import { REMOTES_DIR } from '../config.js';
import { debug } from '../log.js';
import { mergeClaudeMd } from './merge-claude.js';
import { mergeKbDirectories } from './merge-kb.js';
import { mergeSkillsDirectories } from './merge-skills.js';
import { mergeMcpServers } from './merge-mcp.js';
import { mergeAgents } from './merge-agents.js';
import { mergePlugins } from './merge-plugins.js';
import { mergePermissions } from './merge-permissions.js';
import { collectJournalEntries } from './collect-journal.js';
import { type ContentChange, printMergeChanges } from './changes.js';

export async function merge(): Promise<void> {
  if (!existsSync(REMOTES_DIR)) {
    debug('No remotes/ directory found. Merging with existing state only.');
  }

  console.log('\nMerge:');
  const spinner = ora({ text: 'Merging...', prefixText: '  ' }).start();

  const allChanges: ContentChange[] = [];

  const claudeResult = mergeClaudeMd();
  allChanges.push(claudeResult ?? { label: 'CLAUDE.md' });

  const kbResult = mergeKbDirectories();
  allChanges.push(kbResult ?? { label: 'KB' });

  const journalResult = collectJournalEntries();
  if (journalResult) allChanges.push(journalResult);

  const skillsResult = await mergeSkillsDirectories();
  allChanges.push(skillsResult ?? { label: 'skills' });

  const agentsResult = await mergeAgents();
  allChanges.push(agentsResult ?? { label: 'agents' });

  const mcpResult = mergeMcpServers();
  allChanges.push(mcpResult.changes ?? { label: 'MCP' });

  const pluginsResult = mergePlugins();
  allChanges.push(pluginsResult ?? { label: 'plugins' });

  const permResult = mergePermissions();
  allChanges.push(permResult ?? { label: 'permissions' });

  spinner.stop();

  // Print MCP discovery warnings before the change summary
  if (mcpResult.warnings.length > 0) {
    for (const w of mcpResult.warnings) {
      ora({ prefixText: '  ' }).warn(w);
    }
  }

  const hasChanges = allChanges.some((c) => (c.files && c.files.length > 0) || c.summary);

  if (hasChanges) {
    printMergeChanges(allChanges);
  } else {
    console.log(`  Everything up to date.`);
  }

  console.log();
  const label = hasChanges ? 'Merge complete' : 'Merge complete — no changes';
  ora({ prefixText: '  ' }).succeed(label);
}
