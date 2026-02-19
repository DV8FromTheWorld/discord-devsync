import { execFileSync } from 'child_process';
import { mkdirSync } from 'fs';
import { DREAM_LOG_DIR, PROJECT_ROOT } from '../config.js';
import { info, success, error } from '../log.js';

export function consolidate(): void {
  info('Starting dream consolidation...', 'dream');

  mkdirSync(DREAM_LOG_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `\
You are performing a "dream" consolidation of a shared knowledge base and skills library.

Read the following directories and analyze their contents:
- merged/discord-kb/ (knowledge base files — skip journal/ and curiosity/ subdirectories)
- merged/.claude/skills/ (Claude skills)
- merged/discord-kb/journal/ (recent agent journal entries)

Based on your analysis, perform the following maintenance operations:

1. **Merge** redundant or overlapping KB entries into single, comprehensive files
2. **Abstract** specific incident knowledge into general patterns and principles
3. **Prune** information that has been superseded by other entries or is clearly outdated
4. **Reorganize** files and directories for better discoverability and retrieval
5. **Extract skills** from procedural KB content (repeated step-by-step instructions should become skills)
6. **Extract KB** from skills that contain excessive contextual "why" content (that belongs in KB)

Rules:
- Use Read, Glob, and Grep to explore the current state
- Use Write and Edit to make changes to files in merged/
- Use Bash for mv/rm operations when reorganizing
- Be conservative — only make changes you're confident improve the corpus
- Write a brief audit log entry to dream_log/${today}.md describing what you changed and why

When done, print a summary of actions taken.`;

  info('Invoking Claude Code for KB consolidation...', 'dream');
  try {
    execFileSync(
      'claude',
      ['--allowedTools', 'Read,Write,Edit,Glob,Grep,Bash', '--model', 'sonnet', '-p', prompt],
      { cwd: PROJECT_ROOT, stdio: 'inherit' },
    );
  } catch {
    error('Dream consolidation failed', 'dream');
    process.exit(1);
  }

  success('Dream consolidation completed', 'dream');
}
