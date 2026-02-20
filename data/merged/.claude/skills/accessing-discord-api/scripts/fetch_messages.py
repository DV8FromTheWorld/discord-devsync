#!/usr/bin/env python3
"""Fetch messages from a Discord channel or thread.

Usage:
    python3 fetch_messages.py <channel_or_message_url> [--limit N] [--before ID] [--after ID] [--format FORMAT]

Note: --before and --after take SNOWFLAKE IDs, not date strings.
      To convert a date to snowflake:
        discord_epoch = 1420070400000  # 2015-01-01 in ms
        snowflake = (timestamp_ms - discord_epoch) << 22

Examples:
    # Fetch channel history
    python3 fetch_messages.py 1151614857007874098 --limit 50
    python3 fetch_messages.py https://canary.discord.com/channels/1361898292987826229/1151614857007874098

    # Fetch single message by URL
    python3 fetch_messages.py https://canary.discord.com/channels/1361898292987826229/1342570709037350912/1460332751701147831

    # Fetch with pagination (using snowflake ID)
    python3 fetch_messages.py 1461384301479330010 --before 1461400000000000000 --limit 200

    # Fetch messages after Nov 17, 2025 (snowflake: 1439766990028800000)
    python3 fetch_messages.py CHANNEL_ID --after 1439766990028800000 --limit 500
"""

import argparse
import json
import sys

# Add script directory to path for imports
sys.path.insert(0, sys.path[0])
from discord_api import parse_channel_id, paginate_messages, api_request


def format_message_simple(msg):
    """Format message as simple text."""
    timestamp = msg.get("timestamp", "")[:19].replace("T", " ")
    author = msg.get("author", {}).get("global_name") or msg.get("author", {}).get("username", "unknown")
    content = msg.get("content", "")

    # Handle attachments
    attachments = msg.get("attachments", [])
    if attachments:
        att_text = " ".join(f"[{a.get('filename', 'file')}]" for a in attachments)
        if content:
            content = f"{content} {att_text}"
        else:
            content = att_text

    # Handle embeds
    embeds = msg.get("embeds", [])
    if embeds and not content:
        content = f"[{len(embeds)} embed(s)]"

    return f"[{timestamp}] {author}: {content}"


def main():
    parser = argparse.ArgumentParser(description="Fetch messages from a Discord channel, thread, or single message")
    parser.add_argument("channel", help="Channel/message ID or URL (single message if URL contains message ID)")
    parser.add_argument("--limit", "-n", type=int, default=50, help="Number of messages (default: 50, ignored for single message)")
    parser.add_argument("--before", help="Fetch messages before this snowflake ID (not a date)")
    parser.add_argument("--after", help="Fetch messages after this snowflake ID (not a date)")
    parser.add_argument("--format", "-f", choices=["json", "text"], default="json",
                       help="Output format (default: json)")

    args = parser.parse_args()

    _, channel_id, message_id = parse_channel_id(args.channel)

    # Single message fetch (using 'around' param - more reliable than direct endpoint)
    if message_id:
        messages = api_request(f"/channels/{channel_id}/messages", {"around": message_id, "limit": 1})
        if not messages:
            print(f"Error: Message {message_id} not found", file=sys.stderr)
            sys.exit(1)
        message = messages[0]
        if args.format == "json":
            print(json.dumps(message, indent=2))
        else:
            print(format_message_simple(message))
        return

    # Channel history fetch
    messages = list(paginate_messages(
        channel_id,
        limit=args.limit,
        before=args.before,
        after=args.after
    ))

    if args.format == "json":
        print(json.dumps(messages, indent=2))
    else:
        # Reverse for chronological order in text format
        for msg in reversed(messages):
            print(format_message_simple(msg))


if __name__ == "__main__":
    main()
