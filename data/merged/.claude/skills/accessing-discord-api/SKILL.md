---
name: accessing-discord-api
description: Fetches messages, channels, and guild data from Discord's API using the user's staff account. Use when user asks to read Discord messages, summarize threads, analyze channel activity, find conversations, and search for messages by author or content. Triggers on Discord URLs, channel IDs, or requests involving Discord server content.
---

# Discord API Access

Requires `DISCORD_USER_TOKEN` env var. See [SETUP.md](SETUP.md) if not configured.

## Scripts

All scripts are in `~/.claude/skills/accessing-discord-api/scripts/` and accept URLs or plain IDs.

**Important:** Always use `python3` explicitly when running these scripts.

| Script | Purpose | Key Options |
|--------|---------|-------------|
| `fetch_messages.py` | Get messages from channel/thread/URL | `--limit`, `--before`, `--after`, `--format` |
| `fetch_channel.py` | Get channel/thread metadata | — |
| `fetch_guild.py` | Get guild info | `--with-counts` |
| `fetch_guild_channels.py` | List guild channels | `--type` |
| `search_messages.py` | Search guild messages | `--author`, `--content`, `--since`, `--has` |

### Snowflake IDs vs Dates

The `--before` and `--after` parameters in `fetch_messages.py` require **snowflake IDs**, not date strings. To convert a date to a snowflake:

```python
# Discord epoch: 2015-01-01 00:00:00 UTC = 1420070400000 ms
discord_epoch = 1420070400000
timestamp_ms = int(datetime.datetime(YYYY, MM, DD, tzinfo=datetime.timezone.utc).timestamp() * 1000)
snowflake = (timestamp_ms - discord_epoch) << 22
```

In contrast, `search_messages.py` accepts `--since` as a date string (e.g., `2025-11-17`).

## URL Parsing

| Input | Behavior |
|-------|----------|
| `/channels/G/C` | Channel history |
| `/channels/G/C/M` | Single message |
| Snowflake ID | Treated as channel |

## Examples

```bash
# Fetch message by URL
python3 ~/.claude/skills/accessing-discord-api/scripts/fetch_messages.py \
  "https://discord.com/channels/123/456/789"

# Search user's messages since a date (search_messages supports date strings)
python3 ~/.claude/skills/accessing-discord-api/scripts/search_messages.py \
  GUILD_ID --author USER_ID --since 2025-11-17

# Get channel history (most recent 100 messages)
python3 ~/.claude/skills/accessing-discord-api/scripts/fetch_messages.py \
  CHANNEL_ID --limit 100 --format text

# Fetch messages after a specific date (requires snowflake conversion)
# Example: messages after 2025-11-17 00:00 UTC
python3 ~/.claude/skills/accessing-discord-api/scripts/fetch_messages.py \
  CHANNEL_ID --after 1439766990028800000 --limit 500 --format json
```

## Additional Endpoints

See [ENDPOINTS.md](ENDPOINTS.md) for direct API access.
