#!/usr/bin/env python3
"""Search messages in a Discord guild.

Usage:
    python search_messages.py <guild_id> [options]

Examples:
    # Search by author
    python search_messages.py 1361898292987826229 --author 1088605110638227537

    # Search by content
    python search_messages.py 1361898292987826229 --content "rate limit"

    # Search since a date
    python search_messages.py 1361898292987826229 --author 123 --since 2026-01-11

    # Search in specific channel
    python search_messages.py 1361898292987826229 --content "bug" --channel 456

    # Combine filters
    python search_messages.py 1361898292987826229 --author 123 --has attachment --since 2026-01-01
"""

import argparse
import json
import sys
from datetime import datetime

sys.path.insert(0, sys.path[0])
from discord_api import api_request, parse_guild_id


def date_to_snowflake(date_str):
    """Convert YYYY-MM-DD date string to minimum snowflake ID for that date."""
    discord_epoch = 1420070400000
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    timestamp_ms = int(dt.timestamp() * 1000)
    return (timestamp_ms - discord_epoch) << 22


def format_result(msg, guild_id):
    """Format a search result with link."""
    ts = msg.get("timestamp", "")[:16].replace("T", " ")
    author = msg.get("author", {}).get("global_name") or msg.get("author", {}).get("username", "unknown")
    content = msg.get("content", "")
    if len(content) > 100:
        content = content[:100] + "..."
    content = content.replace("\n", " ")

    channel_id = msg.get("channel_id")
    msg_id = msg.get("id")
    url = f"https://discord.com/channels/{guild_id}/{channel_id}/{msg_id}"

    return f"[{ts}] {author}: {content}\n  {url}"


def main():
    parser = argparse.ArgumentParser(description="Search messages in a Discord guild")
    parser.add_argument("guild", help="Guild ID or URL containing guild ID")
    parser.add_argument("--author", "-a", help="Filter by author user ID")
    parser.add_argument("--content", "-c", help="Search text content")
    parser.add_argument("--channel", help="Filter by channel ID")
    parser.add_argument("--since", help="Messages since date (YYYY-MM-DD)")
    parser.add_argument("--before", help="Messages before date (YYYY-MM-DD)")
    parser.add_argument("--has", choices=["link", "embed", "file", "video", "image", "sound", "sticker"],
                       help="Filter by attachment type")
    parser.add_argument("--mentions", help="Filter by mentioned user ID")
    parser.add_argument("--limit", "-n", type=int, default=25, help="Max results (default: 25, max: 25 per page)")
    parser.add_argument("--format", "-f", choices=["json", "text", "links"], default="text",
                       help="Output format (default: text)")

    args = parser.parse_args()

    guild_id = parse_guild_id(args.guild)

    # Build search params
    params = {"include_nsfw": "true"}

    if args.author:
        params["author_id"] = args.author
    if args.content:
        params["content"] = args.content
    if args.channel:
        params["channel_id"] = args.channel
    if args.since:
        params["min_id"] = date_to_snowflake(args.since)
    if args.before:
        params["max_id"] = date_to_snowflake(args.before)
    if args.has:
        params["has"] = args.has
    if args.mentions:
        params["mentions"] = args.mentions

    # Fetch results (paginate if needed)
    all_messages = []
    offset = 0

    while len(all_messages) < args.limit:
        params["offset"] = offset
        result = api_request(f"/guilds/{guild_id}/messages/search", params)

        messages = result.get("messages", [])
        if not messages:
            break

        for msg_group in messages:
            if msg_group:
                all_messages.append(msg_group[0])  # First message is the hit
                if len(all_messages) >= args.limit:
                    break

        total = result.get("total_results", 0)
        offset += 25
        if offset >= total:
            break

    # Output
    if args.format == "json":
        print(json.dumps(all_messages, indent=2))
    elif args.format == "links":
        for msg in all_messages:
            channel_id = msg.get("channel_id")
            msg_id = msg.get("id")
            print(f"https://discord.com/channels/{guild_id}/{channel_id}/{msg_id}")
    else:
        total = result.get("total_results", len(all_messages))
        print(f"Found {total} results (showing {len(all_messages)}):\n")
        for msg in all_messages:
            print(format_result(msg, guild_id))
            print()


if __name__ == "__main__":
    main()
