# Setup: Discord API Access

One-time setup for the accessing-discord-api skill.

## Get Your Token

1. Open Discord in browser (discord.com/app)
2. Open DevTools (F12) → Network tab
3. Do any action, find a request to `discord.com/api`
4. Copy the `Authorization` header value

## Set Environment Variable

```bash
# Add to ~/.bashrc or ~/.zshrc
export DISCORD_USER_TOKEN="your_token_here"
```

Reload: `source ~/.bashrc`

**Security**: This token has full account access. Never share or commit it.

## Self-Botting Policy

Using user tokens for API access is against Discord ToS for regular users. Discord employees are permitted to do this for work purposes.
