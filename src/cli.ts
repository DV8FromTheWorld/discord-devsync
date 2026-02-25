import { configExists, loadConfig, resolveAllHosts, resolveHost } from './config.js';
import { error, setVerbose } from './log.js';
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
import { listHosts, listLayers, listMcp } from './list.js';
import { runImport } from './import.js';
import { mcpAdd } from './mcp-add.js';
import { mcpRemove } from './mcp-remove.js';
import { mcpReview } from './mcp-review.js';
import { permissionsList, permissionsAdd, permissionsRemove } from './permissions.js';

const USAGE = `\
Usage: devsync <command> [subcommand] [options]

Setup:
  init                   First-time setup wizard
  import                 Import existing content (CLAUDE.md, KB, skills, MCP, permissions)
  help                   Show this help message

Sync:
  sync full              Complete sync cycle (pull -> merge -> push -> commit)
  sync pull              Download files from all hosts
  sync merge             Merge downloaded files using Claude Code
  sync push [--host X]   Upload merged files to hosts
  sync commit            Commit changes to git
  sync status            Show current sync status

Dream:
  dream full             Sync + dream + push (pull -> merge -> dream -> push -> commit)
  dream consolidate      Analyze and reorganize KB corpus
  dream curiosity        Generate investigation items
  dream cleanup          Enforce retention policy

Hosts:
  host add               Add a new host interactively
  host list              Show all configured hosts
  host onboard <name>    Full setup of a configured host

List:
  layer list             Show all layers and their contents

MCP:
  mcp list               Show configured MCP servers
  mcp add [name]         Add an MCP server interactively
  mcp remove <name>      Remove an MCP server
  mcp review             Review newly discovered MCP servers

Permissions:
  permissions list       Show synced permission rules
  permissions add <rule> Add a permission rule
  permissions remove <rule> Remove a permission rule
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
  try {
    return loadConfig();
  } catch (e) {
    error((e as Error).message);
    process.exit(1);
  }
}

export async function run(args: string[]): Promise<void> {
  if (args.includes('--verbose') || args.includes('-v')) {
    setVerbose(true);
    args = args.filter((a) => a !== '--verbose' && a !== '-v');
  }

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

  if (command === 'import') {
    requireConfig();
    await runImport();
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
      case 'pull':
      case 'fetch':
        await fetch(hosts);
        break;
      case 'merge':
        await merge();
        break;
      case 'push':
        await push(hosts);
        break;
      case 'commit':
        commit();
        break;
      case 'status':
        status();
        break;
      case 'full':
        await fetch(hosts);
        await merge();
        await push(hosts);
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
        await cleanup(hosts);
        break;
      case 'full':
        await fetch(hosts);
        await merge();
        consolidate();
        curiosity();
        await cleanup(hosts);
        await push(hosts);
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
    } else if (subcommand === 'list') {
      requireConfig();
      listHosts();
    } else if (subcommand === 'onboard') {
      const config = requireConfig();
      const hostName = args[2];
      if (!hostName) {
        error('Usage: devsync host onboard <name>');
        process.exit(1);
      }
      const host = resolveHost(config, hostName);
      await onboard(host);
    } else {
      error(`Unknown host subcommand: ${subcommand}`);
      console.log(USAGE);
      process.exit(1);
    }
  } else if (command === 'layer') {
    if (subcommand === 'list') {
      requireConfig();
      listLayers();
    } else {
      error(`Unknown layer subcommand: ${subcommand}`);
      console.log(USAGE);
      process.exit(1);
    }
  } else if (command === 'mcp') {
    if (subcommand === 'list') {
      listMcp();
    } else if (subcommand === 'add') {
      await mcpAdd(args[2]);
    } else if (subcommand === 'remove') {
      const name = args[2];
      if (!name) {
        error('Usage: devsync mcp remove <name>');
        process.exit(1);
      }
      mcpRemove(name);
    } else if (subcommand === 'review') {
      await mcpReview();
    } else {
      error(`Unknown mcp subcommand: ${subcommand}`);
      console.log(USAGE);
      process.exit(1);
    }
  } else if (command === 'permissions') {
    if (subcommand === 'list') {
      permissionsList();
    } else if (subcommand === 'add') {
      const rule = args.slice(2).join(' ');
      if (!rule) {
        error('Usage: devsync permissions add <rule>');
        process.exit(1);
      }
      permissionsAdd(rule);
    } else if (subcommand === 'remove') {
      const rule = args.slice(2).join(' ');
      if (!rule) {
        error('Usage: devsync permissions remove <rule>');
        process.exit(1);
      }
      permissionsRemove(rule);
    } else {
      error(`Unknown permissions subcommand: ${subcommand}`);
      console.log(USAGE);
      process.exit(1);
    }
  } else {
    error(`Unknown command: ${command}`);
    console.log(USAGE);
    process.exit(1);
  }
}
