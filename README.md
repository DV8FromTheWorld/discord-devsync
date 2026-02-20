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

The setup wizard walks you through:
1. Configuring default paths per platform (macOS / Linux)
2. Choosing machine role — hub-only (pure orchestrator) or hub + host (also receives content)
3. Adding remote hosts with SSH connectivity testing
4. Selecting layers for each host
5. Optionally importing existing content (CLAUDE.md, KB, skills, MCP, permissions)

To add more hosts later:

```bash
devsync host add
```

## Commands

```
devsync init                      First-time setup wizard
devsync import                    Import existing content (CLAUDE.md, KB, skills, MCP, permissions)
devsync help                      Show help

devsync sync full                 pull -> merge -> push -> commit (default)
devsync sync pull                 Pull from all remotes (parallel)
devsync sync merge                Merge (Claude CLI for conflicts)
devsync sync push [--host X]      Push to hosts (parallel)
devsync sync commit               Git commit merged state
devsync sync status               Show state of all hosts

devsync dream full                pull -> merge -> dream -> push -> commit
devsync dream consolidate         KB consolidation via Claude CLI
devsync dream curiosity           Generate investigation items
devsync dream cleanup             Enforce retention policy (4 weeks)

devsync host add                  Add a new host interactively
devsync host list                 Show all configured hosts
devsync host onboard <name>       Full setup of a configured host

devsync layer list                Show all layers and their contents

devsync mcp list                  Show configured MCP servers
devsync mcp add [name]            Add an MCP server interactively
devsync mcp remove <name>         Remove an MCP server
devsync mcp review                Review newly discovered MCP servers from remotes

devsync permissions list          Show synced permission rules
devsync permissions add <rule>    Add a permission rule
devsync permissions remove <rule> Remove a permission rule
```

### Global flags

- `--verbose` / `-v` — Enable debug-level logging (per-operation timings, merge details, etc.)
- `--host <name>` — Filter push/pull to a specific host

## Architecture

Hub-and-spoke model. One machine orchestrates sync across remotes via rsync/SSH. The hub doesn't need the target project — it can be a pure orchestrator, or it can opt-in to receiving content too.

### Sync pipeline

Both pull and push run all hosts in parallel, with each host's operations also running in parallel internally. A shared progress spinner shows real-time completion status.

```
pull (parallel)  ->  merge (sequential)  ->  push (parallel)  ->  commit
```

- **Pull**: fetches CLAUDE.md, KB, skills, MCP config, and permissions from each host concurrently
- **Merge**: combines content from all hosts — single-source files are copied directly, multi-source conflicts use Claude CLI for intelligent merging
- **Push**: uploads the merged state back to each host concurrently, filtered by layer config
- **Commit**: stages and commits the merged state to git

SSH connection multiplexing (`ControlMaster`) is used automatically — the first SSH connection per host establishes a shared socket, and all subsequent operations reuse it.

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

A host can subscribe to multiple layers. The effective config is the union of all its layers — if any layer enables dotfiles, that host gets dotfiles. Skills and MCP servers are unioned across layers.

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

### Secrets and environment variables

Secrets are stored in `data/secrets/env` as `KEY=VALUE` pairs (gitignored). On push, they're written to `~/.devsync-env` on each host that has secrets enabled via its layer config.

MCP server configs can reference secrets using `${VAR_NAME}` syntax — these are resolved at push time before writing to the remote's `~/.claude.json`.

### Dotfiles

Dotfiles are assembled from `data/dotfiles/base/` (platform-agnostic) and `data/dotfiles/<platform>/` (darwin or linux). On push, devsync creates `~/.devsync.sh` on the remote and adds sourcing lines to `~/.bashrc`, `~/.zshrc`, and `~/.config/fish/config.fish`.

### MCP discovery

When pulling from remotes, devsync discovers MCP servers configured on each host (both user-scoped and project-scoped from `~/.claude.json`). New servers that aren't already in the merged state are flagged for review. Run `devsync mcp review` to import or permanently exclude them.

### Dream process

The dream system uses Claude CLI to maintain and improve the knowledge base over time:

- **Consolidate**: merges redundant KB entries, abstracts specific incidents into general patterns, reorganizes files for discoverability, extracts skills from procedural KB entries
- **Curiosity**: generates 3-10 investigation items by analyzing gaps, contradictions, and recurring issues in the KB
- **Cleanup**: enforces a 4-week retention policy on journal entries and dream logs

Dream runs are logged to `data/dream_log/YYYY-MM-DD.md` for auditability.

### Directory layout

```
devsync/
├── src/                        # Tool code
├── bin/                        # CLI wrapper
├── data/
│   ├── config.yaml             # Host + layer definitions
│   ├── dotfiles/               # base/ + darwin/ + linux/ overlays
│   ├── secrets/                # Gitignored API keys (KEY=VALUE)
│   ├── merged/                 # Canonical merged state (pushed to hosts)
│   │   ├── CLAUDE.md
│   │   ├── discord-kb/
│   │   │   ├── journal/        # Date-based journal entries
│   │   │   └── curiosity/      # Generated investigation items
│   │   ├── .claude/skills/
│   │   ├── mcp-servers.json    # Claude-native MCP server configs
│   │   ├── mcp-exclude.json    # Permanently excluded MCP servers
│   │   └── permissions.json    # Claude Code permission rules
│   ├── remotes/                # Fetched per-host state (gitignored)
│   └── dream_log/              # Dream audit trail
├── package.json
└── tsconfig.json
```

## Configuration

The config file (`data/config.yaml`) has three sections:

```yaml
defaults:
  darwin:
    paths:
      claude_md: ~/repos/discord/CLAUDE.md
      kb: ~/repos/discord-kb
      skills: ~/.claude/skills
  linux:
    paths:
      claude_md: ~/workspace/discord/CLAUDE.md
      kb: ~/workspace/discord-kb
      skills: ~/.claude/skills

layers:
  core:
    description: Base development config
    skills: all           # 'all' or list of skill names
    mcp: [buildkite]      # 'all' or list of server names
    dotfiles: true
    secrets: true

hosts:
  devbox-1:
    hostname: devbox-1.internal    # SSH hostname or 'localhost'
    platform: linux
    layers: [core]
    paths:                          # Optional per-host path overrides
      claude_md: ~/custom/path/CLAUDE.md
```

## Prerequisites

- Node.js 18+
- SSH keys for passwordless access to remotes
- Claude Code CLI (on hub for merge/dream)
- rsync
