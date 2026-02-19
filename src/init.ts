import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { input, select, confirm, checkbox } from '@inquirer/prompts';
import {
  CONFIG_PATH,
  MCP_CONFIG_PATH,
  DATA_DIR,
  MERGED_DIR,
  DOTFILES_DIR,
  SECRETS_DIR,
  DREAM_LOG_DIR,
  saveConfig,
  type Config,
  type Platform,
} from './config.js';
import { info, success } from './log.js';
import { checkConnection } from './ssh.js';
import { runImport } from './import.js';

async function promptHost(
  layerNames: string[],
  isLocal: boolean,
): Promise<{ name: string; hostname: string; platform: Platform; layers: string[] } | null> {
  if (!isLocal) {
    const hostname = await input({ message: 'SSH hostname (e.g., my-box.coder):' });
    if (!hostname) return null;

    // Test connectivity
    const testHost = { hostname, isLocal: false } as Parameters<typeof checkConnection>[0];
    info(`  Testing SSH connection to ${hostname}...`);
    let connected = checkConnection(testHost);
    while (!connected) {
      const retry = await confirm({
        message: `Could not connect to ${hostname}. Retry?`,
        default: true,
      });
      if (!retry) {
        const skip = await confirm({ message: 'Skip this host?', default: true });
        if (skip) return null;
      }
      connected = checkConnection(testHost);
    }
    success(`  Connected to ${hostname}`);

    const name = await input({
      message: 'Short name for this host:',
      default: hostname.split('.')[0],
    });

    const platform = await select<Platform>({
      message: 'Platform:',
      choices: [
        { value: 'linux', name: 'Linux (Coder / remote server)' },
        { value: 'darwin', name: 'macOS' },
      ],
      default: 'linux',
    });

    const layers = await checkbox({
      message: 'Layers to enable:',
      choices: layerNames.map((l) => ({ value: l, checked: true })),
    });

    return { name, hostname, platform, layers };
  } else {
    const platform = await select<Platform>({
      message: 'Platform of this machine:',
      choices: [
        { value: 'darwin', name: 'macOS' },
        { value: 'linux', name: 'Linux' },
      ],
    });

    const name = await input({ message: 'Short name for this machine:', default: 'local' });

    const layers = await checkbox({
      message: 'Layers to enable:',
      choices: layerNames.map((l) => ({ value: l, checked: true })),
    });

    return { name, hostname: 'localhost', platform, layers };
  }
}

export async function init(): Promise<void> {
  info('Initializing devsync...');

  if (existsSync(CONFIG_PATH)) {
    const overwrite = await confirm({
      message: 'config.yaml already exists. Overwrite?',
      default: false,
    });
    if (!overwrite) {
      info('Aborted.');
      return;
    }
  }

  // Default paths
  info('Configure default paths for each platform.');
  info('(These apply to all hosts of that platform unless overridden per-host.)');
  console.log();

  const darwinClaudeMd = await input({
    message: 'macOS — Path to CLAUDE.md:',
    default: '~/repos/discord/CLAUDE.md',
  });
  const darwinKb = await input({
    message: 'macOS — Path to KB directory:',
    default: '~/repos/discord-kb',
  });

  const linuxClaudeMd = await input({
    message: 'Linux — Path to CLAUDE.md:',
    default: '~/workspaces/discord/CLAUDE.md',
  });
  const linuxKb = await input({
    message: 'Linux — Path to KB directory:',
    default: '~/workspaces/discord-kb',
  });

  const config: Config = {
    defaults: {
      darwin: {
        paths: {
          claude_md: darwinClaudeMd,
          kb: darwinKb,
          skills: '~/.claude/skills',
        },
      },
      linux: {
        paths: {
          claude_md: linuxClaudeMd,
          kb: linuxKb,
          skills: '~/.claude/skills',
        },
      },
    },
    layers: {
      core: {
        description: 'Base config synced to all hosts',
        skills: 'all',
        dotfiles: true,
        secrets: true,
      },
    },
    hosts: {},
  };

  const layerNames = Object.keys(config.layers);

  // Ask about this machine
  const isHub = await select({
    message: 'What is this machine?',
    choices: [
      { value: 'hub-only', name: 'Hub only (orchestrates sync, does not receive content)' },
      {
        value: 'hub-and-host',
        name: 'Hub + host (orchestrates and receives content, e.g., dev laptop)',
      },
    ],
  });

  let localPlatform: Platform | null = null;
  if (isHub === 'hub-and-host') {
    const local = await promptHost(layerNames, true);
    if (local) {
      localPlatform = local.platform;
      config.hosts[local.name] = {
        hostname: local.hostname,
        platform: local.platform,
        layers: local.layers,
      };
    }
  }

  // Add remote hosts
  let addMore = await confirm({ message: 'Add a remote host?', default: true });
  while (addMore) {
    const host = await promptHost(layerNames, false);
    if (host) {
      config.hosts[host.name] = {
        hostname: host.hostname,
        platform: host.platform,
        layers: host.layers,
      };
    }
    addMore = await confirm({ message: 'Add another remote host?', default: false });
  }

  // Create directory structure
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(MERGED_DIR, { recursive: true });
  mkdirSync(DOTFILES_DIR, { recursive: true });
  mkdirSync(SECRETS_DIR, { recursive: true });
  mkdirSync(DREAM_LOG_DIR, { recursive: true });

  // Write config
  saveConfig(config);
  success(`Config written to ${CONFIG_PATH}`);

  // Write empty MCP config if it doesn't exist
  if (!existsSync(MCP_CONFIG_PATH)) {
    writeFileSync(MCP_CONFIG_PATH, 'servers: {}\n');
    success(`MCP config written to ${MCP_CONFIG_PATH}`);
  }

  // Write empty secrets file if it doesn't exist
  const secretsEnv = `${SECRETS_DIR}/env`;
  if (!existsSync(secretsEnv)) {
    writeFileSync(secretsEnv, '# KEY=VALUE\n');
  }

  // Offer to import existing content from this machine
  const doImport = await confirm({
    message: 'Import existing content from this machine?',
    default: true,
  });
  if (doImport) {
    const importPaths = localPlatform ? config.defaults[localPlatform]?.paths : undefined;
    await runImport(importPaths);
  }

  console.log();
  success('devsync initialized!');
  const hostCount = Object.keys(config.hosts).length;
  if (hostCount > 0) {
    info(`${hostCount} host(s) configured. Run 'devsync sync push' to push content.`);
  } else {
    info("No hosts configured yet. Run 'devsync host add' to add one.");
  }
}
