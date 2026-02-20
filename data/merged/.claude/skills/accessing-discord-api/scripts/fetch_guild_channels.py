#!/usr/bin/env python3
"""Fetch all channels in a guild.

Usage:
    python fetch_guild_channels.py <guild_id_or_url> [--type TYPE]

Examples:
    python fetch_guild_channels.py 1361898292987826229
    python fetch_guild_channels.py 1361898292987826229 --type text
"""

import argparse
import json
import sys

sys.path.insert(0, sys.path[0])
from discord_api import parse_guild_id, api_request

# Channel types from Discord API
CHANNEL_TYPES = {
    0: "text",
    2: "voice",
    4: "category",
    5: "announcement",
    10: "announcement_thread",
    11: "public_thread",
    12: "private_thread",
    13: "stage",
    14: "directory",
    15: "forum",
    16: "media",
}


def main():
    parser = argparse.ArgumentParser(description="Fetch guild channels")
    parser.add_argument("guild", help="Guild ID or URL containing guild ID")
    parser.add_argument("--type", "-t", help="Filter by channel type (text, voice, category, forum, etc.)")

    args = parser.parse_args()

    guild_id = parse_guild_id(args.guild)
    channels = api_request(f"/guilds/{guild_id}/channels")

    # Filter by type if specified
    if args.type:
        type_filter = args.type.lower()
        channels = [
            c for c in channels
            if CHANNEL_TYPES.get(c.get("type"), "").lower() == type_filter
        ]

    print(json.dumps(channels, indent=2))


if __name__ == "__main__":
    main()
