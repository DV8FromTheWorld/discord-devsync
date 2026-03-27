import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { REMOTES_DIR, MERGED_DIR, MCP_SERVERS_PATH, PERMISSIONS_PATH } from '../config.js';
import { info } from '../log.js';

function globMdCount(dir: string): number {
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

export function status(): void {
  info('Sync Status Report');
  console.log();
  console.log('Remote files:');

  if (existsSync(REMOTES_DIR)) {
    for (const host of readdirSync(REMOTES_DIR).sort()) {
      const hostDir = resolve(REMOTES_DIR, host);

      for (const fname of ['user-CLAUDE.md', 'CLAUDE.local.md'] as const) {
        const claudeFile = resolve(hostDir, fname);
        if (existsSync(claudeFile)) {
          const lines = readFileSync(claudeFile, 'utf-8').split('\n').length;
          console.log(`  + ${host} ${fname}: ${lines} lines`);
        } else {
          console.log(`  - ${host} ${fname}: missing`);
        }
      }

      const kbDir = resolve(hostDir, 'discord-kb');
      if (existsSync(kbDir)) {
        console.log(`  + ${host} KB: ${globMdCount(kbDir)} files`);
      } else {
        console.log(`  - ${host} KB: missing`);
      }

      const skillsDir = resolve(hostDir, '.claude', 'skills');
      if (existsSync(skillsDir)) {
        const skills = readdirSync(skillsDir, { withFileTypes: true }).filter((e) =>
          e.isDirectory(),
        );
        console.log(`  + ${host} skills: ${skills.length} skills`);
      } else {
        console.log(`  - ${host} skills: missing`);
      }

      const agentsDir = resolve(hostDir, '.claude', 'agents');
      if (existsSync(agentsDir)) {
        const agents = readdirSync(agentsDir).filter((f) => f.endsWith('.md'));
        console.log(`  + ${host} agents: ${agents.length} agents`);
      }

      const mcpFile = resolve(hostDir, 'mcp-servers.json');
      if (existsSync(mcpFile)) {
        try {
          const mcpData = JSON.parse(readFileSync(mcpFile, 'utf-8'));
          console.log(`  + ${host} MCP: ${Object.keys(mcpData).length} servers`);
        } catch {
          console.log(`  - ${host} MCP: invalid JSON`);
        }
      }

      const permFile = resolve(hostDir, 'permissions.json');
      if (existsSync(permFile)) {
        try {
          const permData = JSON.parse(readFileSync(permFile, 'utf-8'));
          if (Array.isArray(permData)) {
            console.log(`  + ${host} permissions: ${permData.length} rules`);
          }
        } catch {
          console.log(`  - ${host} permissions: invalid JSON`);
        }
      }
    }
  } else {
    console.log('  No remote files downloaded');
  }

  console.log();
  console.log('Merged files:');

  for (const fname of ['user-CLAUDE.md', 'CLAUDE.local.md'] as const) {
    const mergedFile = resolve(MERGED_DIR, fname);
    if (existsSync(mergedFile)) {
      const lines = readFileSync(mergedFile, 'utf-8').split('\n').length;
      console.log(`  + merged/${fname}: ${lines} lines`);
    } else {
      console.log(`  - No merged ${fname}`);
    }
  }

  const kbMerged = resolve(MERGED_DIR, 'discord-kb');
  if (existsSync(kbMerged)) {
    console.log(`  + merged/discord-kb: ${globMdCount(kbMerged)} files`);
  } else {
    console.log('  - No merged KB directory');
  }

  const skillsMerged = resolve(MERGED_DIR, '.claude', 'skills');
  if (existsSync(skillsMerged)) {
    const skills = readdirSync(skillsMerged, { withFileTypes: true }).filter((e) =>
      e.isDirectory(),
    );
    console.log(`  + merged/skills: ${skills.length} skills`);
  } else {
    console.log('  - No merged skills directory');
  }

  const agentsMerged = resolve(MERGED_DIR, '.claude', 'agents');
  if (existsSync(agentsMerged)) {
    const agents = readdirSync(agentsMerged).filter((f) => f.endsWith('.md'));
    console.log(`  + merged/agents: ${agents.length} agents`);
  } else {
    console.log('  - No merged agents');
  }

  if (existsSync(MCP_SERVERS_PATH)) {
    try {
      const mcpData = JSON.parse(readFileSync(MCP_SERVERS_PATH, 'utf-8'));
      console.log(`  + merged/mcp-servers.json: ${Object.keys(mcpData).length} servers`);
    } catch {
      console.log('  - merged/mcp-servers.json: invalid JSON');
    }
  } else {
    console.log('  - No merged MCP servers');
  }

  if (existsSync(PERMISSIONS_PATH)) {
    try {
      const permData = JSON.parse(readFileSync(PERMISSIONS_PATH, 'utf-8'));
      if (Array.isArray(permData)) {
        console.log(`  + merged/permissions.json: ${permData.length} rules`);
      }
    } catch {
      console.log('  - merged/permissions.json: invalid JSON');
    }
  } else {
    console.log('  - No merged permissions');
  }
}
