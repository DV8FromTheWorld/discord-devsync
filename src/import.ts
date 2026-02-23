import { existsSync, readFileSync, readdirSync, mkdirSync, cpSync, copyFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { input, confirm, checkbox } from '@inquirer/prompts';
import { loadConfig, getHostPaths, loadMcpServers, saveMcpServers, loadPermissions, savePermissions, MERGED_DIR, type McpServer, type Paths } from './config.js';
import { info, success, warn } from './log.js';

function expandHome(p: string): string {
  return p.replace(/^~/, homedir());
}

function countSkills(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
}

function countAgents(dir: string): number {
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).filter((f) => f.endsWith('.md')).length;
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

  if (hasClaude || kbCount > 0 || skillCount > 0) {
    const doImport = await confirm({
      message: 'Import found content into devsync?',
      default: true,
    });

    if (doImport) {
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
    }
  }

  // Agents import — detect ~/.claude/agents/*.md
  const localAgentsDir = resolve(homedir(), '.claude', 'agents');
  const agentCount = countAgents(localAgentsDir);
  if (agentCount > 0) {
    info(`  Agents: ${agentCount} agent(s) at ${localAgentsDir}`);
    const doImportAgents = await confirm({
      message: 'Import agent definitions into devsync?',
      default: true,
    });

    if (doImportAgents) {
      const mergedAgents = resolve(MERGED_DIR, '.claude', 'agents');
      mkdirSync(mergedAgents, { recursive: true });
      for (const file of readdirSync(localAgentsDir).filter((f) => f.endsWith('.md'))) {
        copyFileSync(resolve(localAgentsDir, file), resolve(mergedAgents, file));
      }
      success(`  Imported agents (${agentCount})`);
    }
  }

  // MCP and permissions import independently — they read from ~/.claude.json
  // and ~/.claude/settings.json, not from the paths above
  await importMcpServers();
  await importPermissions();
}

async function importMcpServers(): Promise<void> {
  try {
    const claudeJsonPath = resolve(homedir(), '.claude.json');
    if (!existsSync(claudeJsonPath)) return;

    const raw = readFileSync(claudeJsonPath, 'utf-8');
    const claudeJson = JSON.parse(raw);

    // Collect MCP servers from all scopes
    const found: Record<string, { server: McpServer; source: string }> = {};

    // User-scoped servers (top-level mcpServers)
    if (claudeJson.mcpServers && typeof claudeJson.mcpServers === 'object') {
      for (const [name, config] of Object.entries(claudeJson.mcpServers)) {
        const server = config as McpServer;
        if (server.type === 'http' || server.type === 'stdio') {
          found[name] = { server, source: 'user' };
        }
      }
    }

    // Project-scoped servers (under projects)
    if (claudeJson.projects && typeof claudeJson.projects === 'object') {
      for (const [projectPath, projectData] of Object.entries(claudeJson.projects)) {
        const data = projectData as Record<string, unknown>;
        const mcpServers = data.mcpServers as Record<string, McpServer> | undefined;
        if (!mcpServers || typeof mcpServers !== 'object') continue;
        for (const [name, server] of Object.entries(mcpServers)) {
          if (server.type === 'http' || server.type === 'stdio') {
            const shortPath = projectPath.replace(homedir(), '~');
            found[name] = { server, source: shortPath };
          }
        }
      }
    }

    if (Object.keys(found).length === 0) return;

    info(`  Found ${Object.keys(found).length} MCP server(s) in ~/.claude.json`);

    const choices = Object.entries(found).map(([name, { server, source }]) => ({
      value: name,
      name: `${name} (${server.type}, from ${source})`,
      checked: true,
    }));

    const selected = await checkbox({
      message: 'Select MCP servers to import:',
      choices,
    });

    if (selected.length === 0) return;

    const existing = loadMcpServers();
    for (const name of selected) {
      existing[name] = found[name].server;
    }

    saveMcpServers(existing);
    success(`  Imported ${selected.length} MCP server(s) with full config`);
  } catch {
    // ~/.claude.json not found or invalid — skip silently
  }
}

async function importPermissions(): Promise<void> {
  try {
    const settingsPath = resolve(homedir(), '.claude', 'settings.json');
    if (!existsSync(settingsPath)) return;

    const raw = readFileSync(settingsPath, 'utf-8');
    const settings = JSON.parse(raw);

    const permissions = settings.permissions as Record<string, unknown> | undefined;
    const allow = permissions?.allow;
    if (!Array.isArray(allow) || allow.length === 0) return;

    const rules = allow.filter((p: unknown) => typeof p === 'string') as string[];
    if (rules.length === 0) return;

    info(`  Found ${rules.length} permission rule(s) in ~/.claude/settings.json`);
    const doImport = await confirm({
      message: 'Import permission rules into devsync?',
      default: true,
    });

    if (doImport) {
      const existing = loadPermissions();
      const merged = [...new Set([...existing, ...rules])];
      savePermissions(merged);
      success(`  Imported ${rules.length} permission rule(s)`);
    }
  } catch {
    // settings.json not found or invalid — skip silently
  }
}
