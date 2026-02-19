# devsync

Synchronizes developer environment config across multiple machines: Claude Code skills, knowledge base, CLAUDE.md, dotfiles, secrets, and MCP servers. Includes a "dream" process for periodic KB consolidation via Claude CLI.

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
devsync init                 First-time setup wizard
devsync help                 Show help

devsync sync full            fetch → merge → push → commit
devsync sync fetch           Pull from all remotes
devsync sync merge           Merge (Claude CLI for conflicts)
devsync sync push [--host X] Push to hosts
devsync sync commit          Git commit merged state
devsync sync status          Show state of all hosts

devsync dream full           fetch → merge → dream → push → commit
devsync dream consolidate    KB consolidation
devsync dream curiosity      Generate investigation items
devsync dream cleanup        Enforce retention policy

devsync host add             Add a new host interactively
devsync host onboard <name>  Full setup of a configured host
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
| Journal entries | remotes → hub | collect by date |
| Dotfiles | hub → remotes | base + platform overlay |
| Secrets | hub → remotes | rsync (gitignored) |
| MCP servers | hub → remotes | `claude mcp add/remove` |

### Directory layout

```
devsync/
├── src/                        # Tool code
├── bin/                        # CLI wrapper
├── data/
│   ├── config.yaml             # Host + layer definitions
│   ├── mcp-servers.yaml        # MCP server definitions
│   ├── dotfiles/               # base/ + darwin/ + linux/ overlays
│   ├── secrets/                # Gitignored API keys
│   ├── merged/                 # Canonical merged state (pushed to hosts)
│   ├── remotes/                # Fetched per-host state (gitignored)
│   └── dream_log/             # Dream audit trail
├── package.json
└── tsconfig.json
```

## Prerequisites

- Node.js 18+
- SSH keys for passwordless access to remotes
- Claude Code CLI (on hub for merge/dream, on remotes for MCP reconciliation)
- rsync
