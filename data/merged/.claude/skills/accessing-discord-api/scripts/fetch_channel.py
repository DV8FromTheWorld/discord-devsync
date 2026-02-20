#!/usr/bin/env python3
"""Fetch channel or thread information.

Usage:
    python fetch_channel.py <channel_id_or_url>

Examples:
    python fetch_channel.py 1151614857007874098
    python fetch_channel.py https://canary.discord.com/channels/1361898292987826229/1151614857007874098
"""

import argparse
import json
import sys

sys.path.insert(0, sys.path[0])
from discord_api import parse_channel_id, api_request


def main():
    parser = argparse.ArgumentParser(description="Fetch channel or thread information")
    parser.add_argument("channel", help="Channel ID or URL")

    args = parser.parse_args()

    _, channel_id, _ = parse_channel_id(args.channel)
    channel = api_request(f"/channels/{channel_id}")

    print(json.dumps(channel, indent=2))


if __name__ == "__main__":
    main()
