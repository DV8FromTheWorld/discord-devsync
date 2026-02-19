import { configExists, loadConfig, resolveAllHosts, resolveHost } from './config.js';
import { error } from './log.js';
import { fetch } from './sync/fetch.js';
import { merge } from './sync/merge.js';
import { push } from './sync/push.js';
import { commit } from './sync/commit.js';
import { status } from './sync/status.js';
import { consolidate } from './dream/consolidate.js';
import { curiosity } from './dream/curiosity.js';
import { cleanup } from './dream/cleanup.js';
import { onboard } from './onboard.js';
import { init } from './init.js';
import { hostAdd } from './host-add.js';

const USAGE = `\
Usage: devsync <command> [subcommand] [options]

Setup:
  init                   First-time setup wizard
  help                   Show this help message

Sync:
  sync full              Complete sync cycle (fetch -> merge -> push -> commit)
  sync fetch             Download files from all hosts
  sync merge             Merge downloaded files using Claude Code
  sync push [--host X]   Upload merged files to hosts
  sync commit            Commit changes to git
  sync status            Show current sync status

Dream:
  dream full             Sync + dream + push (fetch -> merge -> dream -> push -> commit)
  dream consolidate      Analyze and reorganize KB corpus
  dream curiosity        Generate investigation items
  dream cleanup          Enforce retention policy

Hosts:
  host add               Add a new host interactively
  host onboard <name>    Full setup of a configured host
`;

function getHostFilter(args: string[]): string | undefined {
  const idx = args.indexOf('--host');
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function requireConfig() {
  if (!configExists()) {
    error("No config found. Run 'devsync init' first.");
    process.exit(1);
  }
  return loadConfig();
}

export async function run(args: string[]): Promise<void> {
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
    console.log(USAGE);
    return;
  }

  const command = args[0];
  const subcommand = args[1] ?? 'full';

  if (command === 'init') {
    await init();
    return;
  }

  if (command === 'sync') {
    const config = requireConfig();
    const allHosts = resolveAllHosts(config);

    function getHosts() {
      const hostName = getHostFilter(args);
      if (hostName) return [resolveHost(config, hostName)];
      return allHosts;
    }

    const hosts = getHosts();
    switch (subcommand) {
      case 'fetch':
        fetch(hosts);
        break;
      case 'merge':
        merge();
        break;
      case 'push':
        push(hosts);
        break;
      case 'commit':
        commit();
        break;
      case 'status':
        status();
        break;
      case 'full':
        fetch(hosts);
        merge();
        push(hosts);
        commit();
        break;
      default:
        error(`Unknown sync subcommand: ${subcommand}`);
        console.log(USAGE);
        process.exit(1);
    }
  } else if (command === 'dream') {
    const config = requireConfig();
    const allHosts = resolveAllHosts(config);
    const hosts = (() => {
      const hostName = getHostFilter(args);
      if (hostName) return [resolveHost(config, hostName)];
      return allHosts;
    })();

    switch (subcommand) {
      case 'consolidate':
        consolidate();
        break;
      case 'curiosity':
        curiosity();
        break;
      case 'cleanup':
        cleanup();
        break;
      case 'full':
        fetch(hosts);
        merge();
        consolidate();
        curiosity();
        cleanup();
        push(hosts);
        commit();
        break;
      default:
        error(`Unknown dream subcommand: ${subcommand}`);
        console.log(USAGE);
        process.exit(1);
    }
  } else if (command === 'host') {
    if (subcommand === 'add') {
      await hostAdd();
    } else if (subcommand === 'onboard') {
      const config = requireConfig();
      const hostName = args[2];
      if (!hostName) {
        error('Usage: devsync host onboard <name>');
        process.exit(1);
      }
      const host = resolveHost(config, hostName);
      onboard(host);
    } else {
      error(`Unknown host subcommand: ${subcommand}`);
      console.log(USAGE);
      process.exit(1);
    }
  } else {
    error(`Unknown command: ${command}`);
    console.log(USAGE);
    process.exit(1);
  }
}
