import { existsSync, readdirSync, mkdirSync, cpSync, copyFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';
import { confirm } from '@inquirer/prompts';
import { MERGED_DIR, MCP_CONFIG_PATH, type Paths } from './config.js';
import { info, success, warn } from './log.js';
import { stringify as stringifyYaml } from 'yaml';

function expandHome(p: string): string {
  return p.replace(/^~/, homedir());
}

function countSkills(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
}

function countMdFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  function walk(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = resolve(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) count++;
    }
  }
  walk(dir);
  return count;
}

export async function importExistingContent(paths: Paths): Promise<void> {
  const claudeMdPath = expandHome(paths.claude_md);
  const kbPath = expandHome(paths.kb);
  const skillsPath = expandHome(paths.skills);

  const hasClaude = existsSync(claudeMdPath);
  const kbCount = countMdFiles(kbPath);
  const skillCount = countSkills(skillsPath);

  if (!hasClaude && kbCount === 0 && skillCount === 0) {
    info('No existing content found to import.');
    return;
  }

  console.log();
  info('Found existing content on this machine:');
  if (hasClaude) info(`  CLAUDE.md at ${paths.claude_md}`);
  if (kbCount > 0) info(`  KB: ${kbCount} files at ${paths.kb}`);
  if (skillCount > 0) info(`  Skills: ${skillCount} skills at ${paths.skills}`);

  const doImport = await confirm({
    message: 'Import this content into devsync as the initial state?',
    default: true,
  });

  if (!doImport) return;

  mkdirSync(MERGED_DIR, { recursive: true });

  if (hasClaude) {
    copyFileSync(claudeMdPath, resolve(MERGED_DIR, 'CLAUDE.md'));
    success('  Imported CLAUDE.md');
  }

  if (kbCount > 0) {
    const mergedKb = resolve(MERGED_DIR, 'discord-kb');
    mkdirSync(mergedKb, { recursive: true });
    cpSync(kbPath, mergedKb, { recursive: true });
    success(`  Imported KB (${kbCount} files)`);
  }

  if (skillCount > 0) {
    const mergedSkills = resolve(MERGED_DIR, '.claude', 'skills');
    mkdirSync(mergedSkills, { recursive: true });
    cpSync(skillsPath, mergedSkills, { recursive: true });
    success(`  Imported skills (${skillCount})`);
  }

  // Try to import MCP servers
  await importMcpServers();
}

async function importMcpServers(): Promise<void> {
  try {
    const result = execFileSync('claude', ['mcp', 'list'], {
      encoding: 'utf-8',
      timeout: 10000,
    });

    if (!result || result.includes('No MCP servers')) return;

    // Parse claude mcp list output — format varies, but typically shows server names
    const lines = result
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('-'));

    if (lines.length === 0) return;

    info(`  Found ${lines.length} MCP server(s) configured locally`);
    const doImport = await confirm({
      message:
        'Import MCP server names into mcp-servers.yaml? (You may need to fill in details manually)',
      default: true,
    });

    if (doImport) {
      const servers: Record<string, { transport: string; url: string }> = {};
      for (const line of lines) {
        const name = line.split(/\s+/)[0];
        if (name) {
          servers[name] = { transport: 'http', url: 'TODO: fill in URL' };
        }
      }

      const { writeFileSync } = await import('fs');
      writeFileSync(MCP_CONFIG_PATH, stringifyYaml({ servers }, { lineWidth: 120 }));
      success(
        `  Imported ${Object.keys(servers).length} MCP server stubs (review mcp-servers.yaml)`,
      );
    }
  } catch {
    // Claude CLI not available or errored — skip silently
  }
}
