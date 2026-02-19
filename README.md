# devsync

Synchronizes developer environment config across multiple machines: Claude Code skills, knowledge base, CLAUDE.md, dotfiles, secrets, MCP servers, and permissions. Includes a "dream" process for periodic KB consolidation via Claude CLI.

## Install

```bash
git clone https://github.com/DV8FromTheWorld/discord-devsync.git
cd discord-devsync
pnpm install
pnpm link --global   # makes `devsync` available everywhere
```

## Getting Started

```bash
devsync init
```

The setup wizard walks you through configuring this machine (hub-only or hub + host), adding remote hosts (with SSH connectivity testing), and selecting layers.

To add more hosts later:

```bash
devsync host add
```

## Commands

```
devsync init                      First-time setup wizard
devsync import                    Import existing content (CLAUDE.md, KB, skills, MCP, permissions)
devsync help                      Show help

devsync sync full                 pull -> merge -> push -> commit
devsync sync pull                 Pull from all remotes
devsync sync merge                Merge (Claude CLI for conflicts)
devsync sync push [--host X]      Push to hosts
devsync sync commit               Git commit merged state
devsync sync status               Show state of all hosts

devsync dream full                pull -> merge -> dream -> push -> commit
devsync dream consolidate         KB consolidation
devsync dream curiosity           Generate investigation items
devsync dream cleanup             Enforce retention policy

devsync host add                  Add a new host interactively
devsync host list                 Show all configured hosts
devsync host onboard <name>       Full setup of a configured host

devsync layer list                Show all layers and their contents

devsync mcp list                  Show configured MCP servers
devsync mcp add [name]            Add an MCP server interactively
devsync mcp remove <name>         Remove an MCP server

devsync permissions list          Show synced permission rules
devsync permissions add <rule>    Add a permission rule
devsync permissions remove <rule> Remove a permission rule
```

## Architecture

Hub-and-spoke model. One machine orchestrates sync across remotes via rsync/SSH. The hub doesn't need the target project — it can be a pure orchestrator, or it can opt-in to receiving content too.

### Layers

Hosts opt into **layers** that control what they receive:

```yaml
layers:
  core:
    skills: all
    mcp: [buildkite]
    dotfiles: true
    secrets: true
  mac-tools:
    skills: [screenshot-testing]
    mcp: [browser-tools]
```

### What syncs

| Content | Direction | Method |
|---------|-----------|--------|
| CLAUDE.md | bidirectional | rsync + Claude CLI merge |
| Knowledge base | bidirectional | rsync + Claude CLI merge |
| Skills | bidirectional | rsync + Claude CLI merge (layer-filtered on push) |
| Journal entries | remotes -> hub | collect by date |
| Dotfiles | hub -> remotes | base + platform overlay |
| Secrets | hub -> remotes | rsync (gitignored) |
| MCP servers | bidirectional | JSON patch on `~/.claude.json` (layer-filtered on push) |
| Permissions | bidirectional | JSON patch on `~/.claude/settings.json` |

**MCP servers** and **permissions** are stored in Claude Code's native JSON format. On fetch, devsync extracts the relevant fields from the remote's config files. On push, it patches them back in — preserving all other settings. MCP servers are filtered by layer; permissions are pushed to all hosts.

**Union merge semantics**: if a server or permission exists on any host, it stays in the merged state. Removals are explicit via `devsync mcp remove` or `devsync permissions remove` on the hub.

### Directory layout

```
devsync/
├── src/                        # Tool code
├── bin/                        # CLI wrapper
├── data/
│   ├── config.yaml             # Host + layer definitions
│   ├── dotfiles/               # base/ + darwin/ + linux/ overlays
│   ├── secrets/                # Gitignored API keys
│   ├── merged/                 # Canonical merged state (pushed to hosts)
│   │   ├── CLAUDE.md
│   │   ├── discord-kb/
│   │   ├── .claude/skills/
│   │   ├── mcp-servers.json    # Claude-native MCP server configs
│   │   └── permissions.json    # Claude Code permission rules
│   ├── remotes/                # Fetched per-host state (gitignored)
│   └── dream_log/             # Dream audit trail
├── package.json
└── tsconfig.json
```

## Prerequisites

- Node.js 18+
- SSH keys for passwordless access to remotes
- Claude Code CLI (on hub for merge/dream)
- rsync
