import { existsSync, readdirSync, mkdirSync, cpSync, copyFileSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { homedir } from 'os';
import { input, confirm } from '@inquirer/prompts';
import { loadConfig, getHostPaths, MERGED_DIR, MCP_CONFIG_PATH, type Paths } from './config.js';
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

async function resolvePath(label: string, defaultPath: string): Promise<string> {
  let resolved = expandHome(defaultPath);

  while (!existsSync(resolved)) {
    warn(`  ${label}: not found at ${defaultPath} (${resolved})`);
    const action = await input({
      message: `Enter correct path for ${label}, or 'skip' to skip:`,
      default: defaultPath,
    });

    if (action === 'skip') return '';
    defaultPath = action;
    resolved = expandHome(action);
  }

  return resolved;
}

export async function runImport(paths?: Paths): Promise<void> {
  // If no paths provided, load from config using localhost or first host
  if (!paths) {
    const config = loadConfig();
    const localHost = Object.values(config.hosts).find((h) => h.hostname === 'localhost');
    if (localHost) {
      paths = getHostPaths(config, localHost);
    } else {
      warn('No localhost host configured. Specify paths manually or add a local host first.');
      const claudeMd = await input({
        message: 'Path to CLAUDE.md:',
        default: '~/discord/CLAUDE.md',
      });
      const kb = await input({ message: 'Path to KB directory:', default: '~/discord-kb' });
      const skills = await input({
        message: 'Path to skills directory:',
        default: '~/.claude/skills',
      });
      paths = { claude_md: claudeMd, kb, skills };
    }
  }

  info('Checking for existing content to import...');

  // Resolve each path, letting user fix or skip missing ones
  const claudeMdPath = await resolvePath('CLAUDE.md', paths.claude_md);
  const kbPath = await resolvePath('KB directory', paths.kb);
  const skillsPath = await resolvePath('Skills directory', paths.skills);

  const hasClaude = claudeMdPath && existsSync(claudeMdPath);
  const kbCount = kbPath ? countMdFiles(kbPath) : 0;
  const skillCount = skillsPath ? countSkills(skillsPath) : 0;

  // Report what was found
  console.log();
  if (hasClaude) info(`  CLAUDE.md found at ${claudeMdPath}`);
  else if (claudeMdPath) warn('  CLAUDE.md: skipped');

  if (kbCount > 0) info(`  KB: ${kbCount} files at ${kbPath}`);
  else if (kbPath) warn('  KB: no .md files found');

  if (skillCount > 0) info(`  Skills: ${skillCount} skills at ${skillsPath}`);
  else if (skillsPath) warn('  Skills: no skills found');

  if (!hasClaude && kbCount === 0 && skillCount === 0) {
    info('Nothing to import.');
    return;
  }

  const doImport = await confirm({
    message: 'Import found content into devsync?',
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

  await importMcpServers();
}

async function importMcpServers(): Promise<void> {
  try {
    const result = execFileSync('claude', ['mcp', 'list'], {
      encoding: 'utf-8',
      timeout: 10000,
    });

    if (!result || result.includes('No MCP servers')) return;

    const lines = result
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('-'));

    if (lines.length === 0) return;

    info(`  Found ${lines.length} MCP server(s) configured locally`);
    const doImport = await confirm({
      message: 'Import MCP server names? (You may need to fill in details in mcp-servers.yaml)',
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

      writeFileSync(MCP_CONFIG_PATH, stringifyYaml({ servers }, { lineWidth: 120 }));
      success(
        `  Imported ${Object.keys(servers).length} MCP server stubs (review mcp-servers.yaml)`,
      );
    }
  } catch {
    // Claude CLI not available — skip silently
  }
}
