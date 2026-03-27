import { input, select, confirm, checkbox } from '@inquirer/prompts';
import { loadConfig, saveConfig, resolveHost, type Platform } from './config.js';
import { info, success } from './log.js';
import { checkConnection } from './ssh.js';
import { onboard } from './onboard.js';

export async function hostAdd(): Promise<void> {
  const config = loadConfig();
  const layerNames = Object.keys(config.layers);

  // Hostname
  const hostname = await input({ message: 'SSH hostname (e.g., my-box.coder):' });
  if (!hostname) return;

  // Test connectivity
  const testHost = { hostname, isLocal: false } as Parameters<typeof checkConnection>[0];
  info(`Testing SSH connection to ${hostname}...`);
  let connected = checkConnection(testHost);
  while (!connected) {
    const retry = await confirm({
      message: `Could not connect to ${hostname}. Retry?`,
      default: true,
    });
    if (!retry) return;
    connected = checkConnection(testHost);
  }
  success(`Connected to ${hostname}`);

  // Name
  const name = await input({
    message: 'Short name for this host:',
    default: hostname.split('.')[0],
  });

  if (config.hosts[name]) {
    const overwrite = await confirm({
      message: `Host '${name}' already exists. Overwrite?`,
      default: false,
    });
    if (!overwrite) return;
  }

  // Platform
  const platform = await select<Platform>({
    message: 'Platform:',
    choices: [
      { value: 'linux', name: 'Linux (Coder / remote server)' },
      { value: 'darwin', name: 'macOS' },
    ],
    default: 'linux',
  });

  // Layers
  const layers = await checkbox({
    message: 'Layers to enable:',
    choices: layerNames.map((l) => ({ value: l, checked: true })),
  });

  // Custom paths
  const platformDefaults = config.defaults[platform]?.paths;
  const customPaths = await confirm({
    message: `Use default ${platform} paths? (CLAUDE.local.md: ${platformDefaults?.claude_local_md}, kb: ${platformDefaults?.kb})`,
    default: true,
  });

  const hostConfig: (typeof config.hosts)[string] = {
    hostname,
    platform,
    layers,
  };

  if (!customPaths) {
    hostConfig.paths = {};
    const claudeLocalMd = await input({
      message: 'Path to CLAUDE.local.md:',
      default: platformDefaults?.claude_local_md ?? '~/discord/CLAUDE.local.md',
    });
    if (claudeLocalMd !== platformDefaults?.claude_local_md)
      hostConfig.paths.claude_local_md = claudeLocalMd;

    const userClaudeMd = await input({
      message: 'Path to user CLAUDE.md:',
      default: platformDefaults?.user_claude_md ?? '~/.claude/CLAUDE.md',
    });
    if (userClaudeMd !== platformDefaults?.user_claude_md)
      hostConfig.paths.user_claude_md = userClaudeMd;

    const kb = await input({
      message: 'Path to KB directory:',
      default: platformDefaults?.kb ?? '~/discord-kb',
    });
    if (kb !== platformDefaults?.kb) hostConfig.paths.kb = kb;

    const skills = await input({
      message: 'Path to skills directory:',
      default: platformDefaults?.skills ?? '~/.claude/skills',
    });
    if (skills !== platformDefaults?.skills) hostConfig.paths.skills = skills;

    if (Object.keys(hostConfig.paths).length === 0) delete hostConfig.paths;
  }

  config.hosts[name] = hostConfig;
  saveConfig(config);
  success(`Host '${name}' added to config.`);

  const doOnboard = await confirm({ message: 'Onboard this host now?', default: true });
  if (doOnboard) {
    const resolved = resolveHost(config, name);
    onboard(resolved);
  }
}
