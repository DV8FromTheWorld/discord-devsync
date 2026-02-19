# devsync

Synchronizes developer environment config across multiple machines: Claude Code skills, knowledge base, CLAUDE.md, dotfiles, secrets, and MCP servers. Includes a "dream" process for periodic KB consolidation via Claude CLI.

Built as a superset of [claude-kb](https://github.com/DV8FromTheWorld/claude-kb), rewritten in TypeScript.

## Quick Start

```bash
npm install
npx tsx devsync.ts sync status
```

## Setup

1. Configure hosts and layers in `config.yaml`
2. Define MCP servers in `mcp-servers.yaml`
3. Add dotfiles to `dotfiles/base/` and `dotfiles/{platform}/`
4. Add secrets to `secrets/env` (gitignored)

## Commands

```
devsync sync full              # fetch → merge → push → commit
devsync sync fetch             # Pull from all remotes
devsync sync merge             # Merge (Claude CLI for conflicts)
devsync sync push [--host X]   # Push to hosts
devsync sync commit            # Git commit merged state
devsync sync status            # Show state of all hosts

devsync dream full             # fetch → merge → dream → push → commit
devsync dream consolidate      # KB consolidation
devsync dream curiosity        # Generate investigation items
devsync dream cleanup          # Enforce retention policy

devsync host onboard <name>    # Full setup of a new host
```

## Architecture

Hub-and-spoke model. One machine (your laptop or a dedicated box) is the hub that coordinates sync across remotes via rsync/SSH.

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

hosts:
  macbook:
    platform: darwin
    layers: [core, mac-tools]
  age-ii:
    platform: linux
    layers: [core]
```

### What syncs

| Content | Direction | Method |
|---------|-----------|--------|
| CLAUDE.md | bidirectional | rsync + Claude CLI merge |
| Knowledge base | bidirectional | rsync + Claude CLI merge |
| Skills | bidirectional | rsync + Claude CLI merge |
| Journal entries | remotes → hub | collect by date |
| Dotfiles | hub → remotes | base + platform overlay |
| Secrets | hub → remotes | rsync (gitignored) |
| MCP servers | hub → remotes | `claude mcp add/remove` |

### Dream process

Periodic (e.g. weekly) KB maintenance:
- **Consolidate**: merges redundant entries, abstracts patterns, extracts skills
- **Curiosity**: generates investigation items from journal gaps
- **Cleanup**: enforces 4-week retention on journal/dream logs

### Journal system

Agents write to `~/discord-kb/journal/YYYY-MM-DD.md` on their remote host:

```markdown
### HH:MM — Brief task description
- **Gaps**: Things searched for in KB but not found
- **Stale**: KB entries found to be outdated
- **Surprises**: Unexpected behaviors or findings
- **Learned**: Specific insights worth recording
```

## Prerequisites

- Node.js 18+
- SSH keys for passwordless access to remotes
- Claude Code CLI on hub and remotes
- rsync
