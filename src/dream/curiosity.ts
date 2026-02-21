import { execFileSync } from 'child_process';
import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { MERGED_DIR, PROJECT_ROOT } from '../config.js';
import { info, success, error } from '../log.js';

export function curiosity(): void {
  info('Starting curiosity generation...');

  mkdirSync(resolve(MERGED_DIR, 'discord-kb', 'curiosity'), { recursive: true });

  const prompt = `\
You are generating "curiosity" items — open questions and investigation prompts for agents.

Read the following to identify gaps and opportunities:
- data/merged/discord-kb/ (knowledge base)
- data/merged/discord-kb/journal/{hostname}/ (recent agent journal entries, organized per host)
- data/merged/discord-kb/curiosity/active.md (previous curiosity items, if it exists)

Sources of curiosity:
1. **KB gaps**: Things agents searched for but didn't find (look for "Gaps" in journal entries)
2. **Contradictions**: Conflicting information between KB entries
3. **Recurring issues**: Patterns where multiple agents hit the same problem
4. **Stale flags**: Entries flagged as outdated in journals but not yet fixed
5. **Thin coverage**: Areas that seem important but have little documentation

Write the result to data/merged/discord-kb/curiosity/active.md using this format:

\`\`\`markdown
# Open Questions

## [Topic tag]
**Question**: ...
**Why**: What triggered this (journal pattern, gap, etc.)
**Related**: Links to relevant KB files or skills
**Generated**: YYYY-MM-DD
\`\`\`

Rules:
- Replace the entire active.md file (not append-only)
- Drop items from the previous active.md that appear to have been investigated (check journals)
- Promote persistent uninvestigated items (make them more prominent/specific)
- Drop items that seem not actually useful after multiple cycles
- Generate 3-10 items total — quality over quantity
- Use Read, Glob, and Grep to explore content

Print a brief summary when done.`;

  info('Invoking Claude Code for curiosity generation...');
  try {
    execFileSync(
      'claude',
      ['--allowedTools', 'Read,Write,Glob,Grep', '--model', 'sonnet', '-p', prompt],
      {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
      },
    );
  } catch {
    error('Curiosity generation failed');
    process.exit(1);
  }

  success('Curiosity generation completed');
}
