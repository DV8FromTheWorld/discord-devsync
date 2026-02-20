#!/usr/bin/env python3
"""Common utilities for Discord API access."""

import json
import os
import re
import sys
import time
import urllib.request
import urllib.error

API_BASE = "https://discord.com/api/v10"


def get_token():
    """Get Discord user token from environment."""
    token = os.environ.get("DISCORD_USER_TOKEN")
    if not token:
        print("Error: DISCORD_USER_TOKEN environment variable not set.", file=sys.stderr)
        print("See skill setup instructions for how to obtain your token.", file=sys.stderr)
        sys.exit(1)
    return token


def parse_channel_id(input_str):
    """Extract channel ID from URL or plain ID.

    Accepts:
    - https://discord.com/channels/GUILD_ID/CHANNEL_ID
    - https://discord.com/channels/GUILD_ID/CHANNEL_ID/MESSAGE_ID
    - https://canary.discord.com/channels/GUILD_ID/CHANNEL_ID
    - Plain snowflake ID

    Returns (guild_id, channel_id, message_id) tuple.
    guild_id and message_id may be None.
    """
    # URL pattern: /channels/guild_id/channel_id/message_id (optional)
    url_match = re.search(r'/channels/(\d+)/(\d+)(?:/(\d+))?', input_str)
    if url_match:
        return url_match.group(1), url_match.group(2), url_match.group(3)

    # Plain snowflake (assumed to be channel ID)
    if re.match(r'^\d+$', input_str):
        return None, input_str, None

    print(f"Error: Cannot parse '{input_str}' as channel ID or URL.", file=sys.stderr)
    sys.exit(1)


def parse_guild_id(input_str):
    """Extract guild ID from URL or plain ID."""
    # URL pattern: /channels/guild_id/...
    url_match = re.search(r'/channels/(\d+)', input_str)
    if url_match:
        return url_match.group(1)

    # Plain snowflake
    if re.match(r'^\d+$', input_str):
        return input_str

    print(f"Error: Cannot parse '{input_str}' as guild ID or URL.", file=sys.stderr)
    sys.exit(1)


def api_request(endpoint, params=None):
    """Make authenticated request to Discord API with rate limit handling.

    Args:
        endpoint: API endpoint path (e.g., "/channels/123/messages")
        params: Optional dict of query parameters

    Returns:
        Parsed JSON response
    """
    token = get_token()

    url = f"{API_BASE}{endpoint}"
    if params:
        query = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
        if query:
            url = f"{url}?{query}"

    headers = {
        "Authorization": token,
        "Content-Type": "application/json",
        "User-Agent": "ClaudeCodeSkill (discord-api-access, 1.0)",
    }

    max_retries = 5
    for attempt in range(max_retries):
        req = urllib.request.Request(url, headers=headers)

        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read().decode())

        except urllib.error.HTTPError as e:
            if e.code == 429:
                # Rate limited - respect Retry-After
                retry_after = float(e.headers.get("Retry-After", 1))
                body = json.loads(e.read().decode())

                if body.get("global"):
                    print(f"Global rate limit hit. Waiting {retry_after}s...", file=sys.stderr)
                else:
                    print(f"Rate limited. Waiting {retry_after}s...", file=sys.stderr)

                time.sleep(retry_after)
                continue

            elif e.code == 401:
                print("Error: Invalid or expired token.", file=sys.stderr)
                sys.exit(1)
            elif e.code == 403:
                print(f"Error: Access denied to {endpoint}. Check permissions.", file=sys.stderr)
                sys.exit(1)
            elif e.code == 404:
                print(f"Error: Resource not found: {endpoint}", file=sys.stderr)
                sys.exit(1)
            else:
                print(f"Error: HTTP {e.code}: {e.reason}", file=sys.stderr)
                sys.exit(1)

        except urllib.error.URLError as e:
            print(f"Error: Network error: {e.reason}", file=sys.stderr)
            sys.exit(1)

    print(f"Error: Max retries ({max_retries}) exceeded.", file=sys.stderr)
    sys.exit(1)


def paginate_messages(channel_id, limit=100, before=None, after=None):
    """Fetch messages with automatic pagination.

    Args:
        channel_id: Channel or thread ID
        limit: Total messages to fetch (will paginate if > 100)
        before: Fetch messages before this message ID
        after: Fetch messages after this message ID

    Yields:
        Message objects
    """
    fetched = 0
    current_before = before

    while fetched < limit:
        batch_size = min(100, limit - fetched)
        params = {"limit": batch_size}

        if current_before:
            params["before"] = current_before
        if after and not current_before:
            params["after"] = after

        messages = api_request(f"/channels/{channel_id}/messages", params)

        if not messages:
            break

        for msg in messages:
            yield msg
            fetched += 1
            if fetched >= limit:
                break

        # Set up for next page (messages are newest-first)
        current_before = messages[-1]["id"]

        # Small delay between pages to be nice to rate limits
        if fetched < limit and messages:
            time.sleep(0.1)
