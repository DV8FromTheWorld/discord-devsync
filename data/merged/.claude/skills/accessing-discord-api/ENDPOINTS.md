# Discord API Endpoints Reference

For endpoints not covered by the bundled scripts, use `discord_api.api_request()` directly.

## Official Documentation

Full API docs: https://github.com/discord/discord-api-docs

Key sections:
- Resources: https://github.com/discord/discord-api-docs/tree/main/docs/resources
- Topics: https://github.com/discord/discord-api-docs/tree/main/docs/topics

## Common Endpoints

### Messages

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/channels/{id}/messages` | GET | Get messages (params: limit, before, after, around) |
| `/channels/{id}/messages/{id}` | GET | Get single message |
| `/channels/{id}/pins` | GET | Get pinned messages |

### Channels & Threads

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/channels/{id}` | GET | Get channel/thread info |
| `/channels/{id}/threads/archived/public` | GET | List public archived threads |
| `/channels/{id}/threads/archived/private` | GET | List private archived threads |
| `/guilds/{id}/threads/active` | GET | List active threads in guild |

### Guilds

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/guilds/{id}` | GET | Get guild info |
| `/guilds/{id}/channels` | GET | Get guild channels |
| `/guilds/{id}/members` | GET | List members (params: limit, after) |
| `/guilds/{id}/members/{user_id}` | GET | Get specific member |
| `/guilds/{id}/members/search` | GET | Search members (params: query, limit) |

### Users

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/users/@me` | GET | Get current user |
| `/users/{id}` | GET | Get user by ID |
| `/users/@me/guilds` | GET | Get current user's guilds |

### Reactions

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/channels/{id}/messages/{id}/reactions/{emoji}` | GET | Get users who reacted |

## Making Custom Requests

```python
import sys
sys.path.insert(0, "/home/discord/.claude/skills/accessing-discord-api/scripts")
from discord_api import api_request

# Example: Get current user
user = api_request("/users/@me")

# Example: Get active threads
threads = api_request(f"/guilds/{guild_id}/threads/active")

# Example: Search members
members = api_request(f"/guilds/{guild_id}/members/search", {"query": "brad", "limit": 10})
```

## Query Parameters

### Pagination
Most list endpoints support:
- `limit`: Max items to return (usually 1-100)
- `before`: Snowflake ID, get items before this
- `after`: Snowflake ID, get items after this

### Snowflake IDs
Discord IDs encode timestamps. To convert:
```python
from datetime import datetime
timestamp = ((snowflake_id >> 22) + 1420070400000) / 1000
dt = datetime.fromtimestamp(timestamp)
```
