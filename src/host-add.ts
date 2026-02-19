import { input, select, confirm, checkbox } from '@inquirer/prompts';
import { loadConfig, saveConfig, resolveHost, type Platform } from './config.js';
import { info, success } from './log.js';
import { sshCheck } from './ssh.js';
import { onboard } from './onboard.js';

export async function hostAdd(): Promise<void> {
  const config = loadConfig();
  const layerNames = Object.keys(config.layers);

  // Hostname
  const hostname = await input({ message: 'SSH hostname (e.g., my-box.coder):' });
  if (!hostname) return;

  // Test connectivity
  const testHost = { hostname, isLocal: false } as Parameters<typeof sshCheck>[0];
  info(`Testing SSH connection to ${hostname}...`);
  let connected = sshCheck(testHost);
  while (!connected) {
    const retry = await confirm({
      message: `Could not connect to ${hostname}. Retry?`,
      default: true,
    });
    if (!retry) return;
    connected = sshCheck(testHost);
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
    message: `Use default ${platform} paths? (claude_md: ${platformDefaults?.claude_md}, kb: ${platformDefaults?.kb})`,
    default: true,
  });

  const hostConfig: (typeof config.hosts)[string] = {
    hostname,
    platform,
    layers,
  };

  if (!customPaths) {
    hostConfig.paths = {};
    const claudeMd = await input({
      message: 'Path to CLAUDE.md:',
      default: platformDefaults?.claude_md ?? '~/discord/CLAUDE.md',
    });
    if (claudeMd !== platformDefaults?.claude_md) hostConfig.paths.claude_md = claudeMd;

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
