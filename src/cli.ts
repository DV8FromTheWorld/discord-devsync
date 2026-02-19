import { loadConfig, resolveAllHosts, resolveHost } from './config.js';
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

const USAGE = `\
Usage: devsync <command> [subcommand] [options]

Sync commands:
  sync full              Complete sync cycle (fetch -> merge -> push -> commit)
  sync fetch             Download files from all hosts
  sync merge             Merge downloaded files using Claude Code
  sync push [--host X]   Upload merged files to hosts
  sync commit            Commit changes to git
  sync status            Show current sync status

Dream commands:
  dream full             Sync + dream + push (fetch -> merge -> dream -> push -> commit)
  dream consolidate      Analyze and reorganize KB corpus
  dream curiosity        Generate investigation items
  dream cleanup          Enforce retention policy

Host commands:
  host onboard <name>    Full setup of a new host

Examples:
  devsync sync full
  devsync dream full
  devsync host onboard age-ii
  devsync sync push --host age-ii
`;

function getHostFilter(args: string[]): string | undefined {
  const idx = args.indexOf('--host');
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

export function run(args: string[]): void {
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help' || args[0] === 'help') {
    console.log(USAGE);
    process.exit(0);
  }

  const command = args[0];
  const subcommand = args[1] ?? 'full';

  const config = loadConfig();
  const allHosts = resolveAllHosts(config);

  function getHosts(): typeof allHosts {
    const hostName = getHostFilter(args);
    if (hostName) return [resolveHost(config, hostName)];
    return allHosts;
  }

  if (command === 'sync') {
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
    const hosts = getHosts();
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
    if (subcommand === 'onboard') {
      const hostName = args[2];
      if (!hostName) {
        error('Usage: devsync host onboard <hostname>');
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
