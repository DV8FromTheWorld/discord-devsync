#!/usr/bin/env python3
"""Fetch guild (server) information.

Usage:
    python fetch_guild.py <guild_id_or_url> [--with-counts]

Examples:
    python fetch_guild.py 1361898292987826229
    python fetch_guild.py https://canary.discord.com/channels/1361898292987826229/1151614857007874098 --with-counts
"""

import argparse
import json
import sys

sys.path.insert(0, sys.path[0])
from discord_api import parse_guild_id, api_request


def main():
    parser = argparse.ArgumentParser(description="Fetch guild information")
    parser.add_argument("guild", help="Guild ID or URL containing guild ID")
    parser.add_argument("--with-counts", action="store_true",
                       help="Include approximate member and presence counts")

    args = parser.parse_args()

    guild_id = parse_guild_id(args.guild)
    params = {}
    if args.with_counts:
        params["with_counts"] = "true"

    guild = api_request(f"/guilds/{guild_id}", params if params else None)

    print(json.dumps(guild, indent=2))


if __name__ == "__main__":
    main()
