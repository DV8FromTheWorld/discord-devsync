import { existsSync, mkdirSync, statSync, writeFileSync, readFileSync, appendFileSync, rmSync } from 'fs';
import { execFileSync } from 'child_process';
import { resolve } from 'path';
import { input, select, confirm, checkbox } from '@inquirer/prompts';
import { stringify as stringifyYaml } from 'yaml';
import ora from 'ora';
import { DEVSYNC_CONFIG_DIR, DATA_DIR_FILE, type Config, type Platform } from './config.js';
import { info, success, error } from './log.js';
import { checkConnection } from './ssh.js';
import { runImport } from './import.js';

const DEFAULT_DATA_DIR = resolve(DEVSYNC_CONFIG_DIR, 'data');

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

async function setupDataDir(): Promise<string> {
  const mode = await select({
    message: 'How would you like to set up your data directory?',
    choices: [
      { value: 'fresh', name: 'Start fresh' },
      { value: 'git', name: 'Clone from a git repository' },
      { value: 'path', name: 'Use an existing directory' },
    ],
  });

  if (mode === 'fresh') {
    if (existsSync(DEFAULT_DATA_DIR)) {
      const overwrite = await confirm({
        message: `${DEFAULT_DATA_DIR} already exists. Remove it and start fresh?`,
        default: false,
      });
      if (!overwrite) {
        error('Aborted.');
        process.exit(1);
      }
      rmSync(DEFAULT_DATA_DIR, { recursive: true, force: true });
    }

    mkdirSync(DEFAULT_DATA_DIR, { recursive: true });

    try {
      execFileSync('git', ['init'], { cwd: DEFAULT_DATA_DIR, stdio: 'pipe' });
    } catch (e) {
      error(`Failed to initialize git repository in ${DEFAULT_DATA_DIR}.`);
      error((e as Error).message);
      process.exit(1);
    }

    success(`Created data directory at ${DEFAULT_DATA_DIR}`);
    return DEFAULT_DATA_DIR;
  }

  if (mode === 'git') {
    const url = await input({ message: 'Git repository URL:' });
    if (!url) {
      error('No URL provided. Aborted.');
      process.exit(1);
    }

    if (existsSync(DEFAULT_DATA_DIR)) {
      const overwrite = await confirm({
        message: `${DEFAULT_DATA_DIR} already exists. Remove it and clone?`,
        default: false,
      });
      if (!overwrite) {
        error('Aborted.');
        process.exit(1);
      }
      rmSync(DEFAULT_DATA_DIR, { recursive: true, force: true });
    }

    mkdirSync(DEVSYNC_CONFIG_DIR, { recursive: true });

    const spinner = ora({ prefixText: '  ' }).start(`Cloning ${url}...`);
    try {
      execFileSync('git', ['clone', url, DEFAULT_DATA_DIR], { stdio: 'pipe' });
      spinner.succeed(`Cloned into ${DEFAULT_DATA_DIR}`);
    } catch (e) {
      spinner.fail('Clone failed');
      const msg = (e as Error).message;
      error(msg);
      error('Check that the URL is correct and you have access.');
      process.exit(1);
    }

    let dataDir = DEFAULT_DATA_DIR;

    // Check if data lives in a subfolder of the repo
    const configPath = resolve(dataDir, 'config.yaml');
    if (!existsSync(configPath)) {
      const useSub = await confirm({
        message: 'No config.yaml found at the repo root. Is the data in a subfolder?',
        default: false,
      });
      if (useSub) {
        const sub = await input({ message: 'Subfolder path (relative to repo root):' });
        if (sub) {
          const subPath = resolve(dataDir, sub);
          if (!existsSync(subPath) || !statSync(subPath).isDirectory()) {
            error(`Subfolder not found: ${subPath}`);
            process.exit(1);
          }
          dataDir = subPath;
        }
      } else {
        info('Note: No config.yaml found. You may need to run the setup wizard.');
      }
    }

    return dataDir;
  }

  // mode === 'path'
  const customPath = await input({ message: 'Path to existing data directory:' });
  if (!customPath) {
    error('No path provided. Aborted.');
    process.exit(1);
  }

  const resolved = resolve(customPath.replace(/^~/, process.env.HOME ?? '~'));
  if (!existsSync(resolved)) {
    error(`Directory not found: ${resolved}`);
    process.exit(1);
  }

  const stat = statSync(resolved);
  if (!stat.isDirectory()) {
    error(`Not a directory: ${resolved}`);
    process.exit(1);
  }

  const configPath = resolve(resolved, 'config.yaml');
  if (!existsSync(configPath)) {
    info('Note: No config.yaml found at that path. You may need to run the setup wizard.');
  }

  success(`Using data directory at ${resolved}`);
  return resolved;
}

function writeDataDirPointer(dataDir: string): void {
  mkdirSync(DEVSYNC_CONFIG_DIR, { recursive: true });
  writeFileSync(DATA_DIR_FILE, dataDir + '\n');
}

function ensureSubdirs(dataDir: string): void {
  for (const sub of ['merged', 'remotes', 'dotfiles', 'secrets', 'dream_log']) {
    mkdirSync(resolve(dataDir, sub), { recursive: true });
  }
}

function ensureGitignore(dataDir: string): void {
  const gitignorePath = resolve(dataDir, '.gitignore');
  const required = ['remotes/', 'secrets/'];

  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, required.join('\n') + '\n');
    return;
  }

  const existing = readFileSync(gitignorePath, 'utf-8');
  const lines = existing.split('\n');
  const missing = required.filter((entry) => !lines.includes(entry));
  if (missing.length > 0) {
    const suffix = existing.endsWith('\n') ? '' : '\n';
    appendFileSync(gitignorePath, suffix + missing.join('\n') + '\n');
  }
}

export async function init(): Promise<void> {
  info('Initializing devsync...\n');

  // Step 1: Set up data directory
  const dataDir = await setupDataDir();
  writeDataDirPointer(dataDir);

  // Compute local paths based on the chosen data dir
  const configPath = resolve(dataDir, 'config.yaml');
  const secretsDir = resolve(dataDir, 'secrets');

  // Ensure directory structure
  ensureSubdirs(dataDir);
  ensureGitignore(dataDir);

  // Check if config already exists in the data dir
  if (existsSync(configPath)) {
    const reconfigure = await confirm({
      message: 'config.yaml already exists in the data directory. Reconfigure?',
      default: false,
    });
    if (!reconfigure) {
      console.log();
      success('devsync initialized!');
      info(`Data directory: ${dataDir}`);
      return;
    }
  }

  // Step 2: Configure default paths
  console.log();
  info('Configure default paths for each platform.');
  info('(These apply to all hosts of that platform unless overridden per-host.)');
  console.log();

  const darwinClaudeMd = await input({
    message: 'macOS — Path to CLAUDE.md:',
    default: '~/repos/discord/CLAUDE.md',
  });
  const darwinKb = await input({
    message: 'macOS — Path to KB directory:',
    default: '~/discord-kb',
  });

  const linuxClaudeMd = await input({
    message: 'Linux — Path to CLAUDE.md:',
    default: '~/workspace/discord/CLAUDE.md',
  });
  const linuxKb = await input({
    message: 'Linux — Path to KB directory:',
    default: '~/discord-kb',
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

  // Step 3: Configure hosts
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

  // Write config directly (don't rely on config.ts constants since DATA_DIR may not match)
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(configPath, stringifyYaml(config, { lineWidth: 120 }));
  success(`Config written to ${configPath}`);

  // Write empty secrets file if it doesn't exist
  const secretsEnv = resolve(secretsDir, 'env');
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
  info(`Data directory: ${dataDir}`);
  const hostCount = Object.keys(config.hosts).length;
  if (hostCount > 0) {
    info(`${hostCount} host(s) configured. Run 'devsync sync push' to push content.`);
  } else {
    info("No hosts configured yet. Run 'devsync host add' to add one.");
  }
}
