#!/usr/bin/env python3
"""
Main script for daily news digest.
Supports modes:
  - fetch:   Fetch news, save as draft (for review)
  - send:    Read draft and send email
  - webhook: Read draft and send webhook only (no email)
  - (default): Fetch + send in one step (legacy behavior)
"""

import os
import sys
import json
from datetime import datetime
from zoneinfo import ZoneInfo

from fetch_news import (
    fetch_news, format_email_html, save_draft, load_draft, load_settings,
    summarize_news_with_claude,
)
from send_email import send_email
from send_webhook import send_webhook


def run_fetch(settings: dict, manual: bool = False) -> int:
    """Fetch news and save as draft for email + each webhook channel.

    Steps:
    1. RSS fetch once
    2. Collect all needed topic_modes (email + channels), deduplicate
    3. Call Claude once per unique mode
    4. Save email draft + per-channel drafts (reuse results for same mode)
    """
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        print("Error: ANTHROPIC_API_KEY not set")
        return 1

    topic = settings.get("news_topic", "AI")
    max_items = settings.get("max_news_items", 10)
    email_topic_mode = settings.get("topic_mode", "broad")

    # Collect all needed topic_modes
    channels = settings.get("webhook_channels", [])
    enabled_channels = [ch for ch in channels if ch.get("enabled", False)]

    all_modes = {email_topic_mode}
    for ch in enabled_channels:
        all_modes.add(ch.get("topic_mode", "broad"))

    # If any mode is focused, enable hardware_unlimited for RSS fetch
    hardware_unlimited = "focused" in all_modes

    print(f"Fetching news... (manual={manual})")
    print(f"  - Email topic_mode: {email_topic_mode}")
    print(f"  - Enabled channels: {len(enabled_channels)}")
    print(f"  - Unique modes needed: {all_modes}")

    # Fetch news for the email's topic_mode (RSS fetch happens here once)
    news_data = fetch_news(
        anthropic_key, topic=topic, max_items=max_items,
        settings=settings, manual=manual, hardware_unlimited=hardware_unlimited,
    )

    if news_data.get("error"):
        print(f"Warning: {news_data['error']}")

    raw_articles = news_data.get("_raw_articles", [])

    categories = news_data.get("categories", [])
    total_news = sum(len(c.get("news", [])) for c in categories)
    print(f"Got {total_news} news items in {len(categories)} categories")

    if categories:
        for cat in categories:
            icon = cat.get("icon", "")
            name = cat.get("name", "")
            count = len(cat.get("news", []))
            print(f"   {icon} {name}: {count}")

    # Save email draft
    draft_path = save_draft(news_data, settings)
    print(f"Email draft saved: {draft_path}")

    # Cache of Claude results by topic_mode (email mode already done)
    mode_results = {email_topic_mode: categories}

    # Process each enabled channel
    for ch in enabled_channels:
        ch_id = ch.get("id", "unknown")
        ch_mode = ch.get("topic_mode", "broad")
        ch_name = ch.get("name", ch_id)
        print(f"\n--- Channel: {ch_name} (id={ch_id}, mode={ch_mode}) ---")

        if ch_mode in mode_results:
            # Reuse existing Claude result
            ch_categories = mode_results[ch_mode]
            print(f"  Reusing {ch_mode} mode result ({sum(len(c.get('news', [])) for c in ch_categories)} items)")
        else:
            # Need a separate Claude call for this mode
            if not raw_articles:
                print(f"  No raw articles available, skipping Claude call")
                ch_categories = []
            else:
                print(f"  Calling Claude for {ch_mode} mode...")
                # Create a temporary settings copy with this mode
                ch_settings = {**settings, "topic_mode": ch_mode}
                ch_categories = summarize_news_with_claude(
                    anthropic_key, raw_articles, max_items, ch_settings,
                )
                total = sum(len(c.get("news", [])) for c in ch_categories)
                print(f"  Got {total} items for {ch_mode} mode")
            mode_results[ch_mode] = ch_categories

        # Build channel draft data
        ch_draft = {
            "date": news_data.get("date"),
            "time_window": news_data.get("time_window"),
            "categories": ch_categories,
        }
        ch_draft_path = save_draft(ch_draft, settings, channel_id=ch_id)
        print(f"  Channel draft saved: {ch_draft_path}")

    return 0


def run_send(settings: dict, date: str = None) -> int:
    """Read draft and send email, then send all enabled channel webhooks."""
    draft = load_draft(date)
    if not draft:
        tz = ZoneInfo(settings.get("timezone", "Asia/Shanghai"))
        today = date or datetime.now(tz).strftime("%Y-%m-%d")
        print(f"Error: No draft found for {today}")
        return 1

    # Mark draft as sent
    draft["status"] = "sent"

    email_body = format_email_html(draft, settings)
    email_subject = f"AI/科技新闻日报 - {draft['date']}"
    print(f"HTML email generated ({len(email_body)} bytes)")

    print("Sending email...")
    success = send_email(subject=email_subject, body=email_body)

    if success:
        # Update draft status
        save_draft(draft, settings)

        # Send webhook for each enabled channel
        channels = settings.get("webhook_channels", [])
        enabled_channels = [ch for ch in channels if ch.get("enabled", False)]

        if enabled_channels:
            _send_all_channels(settings, date or draft.get("date"), enabled_channels)
        elif settings.get("webhook_enabled", False):
            # Legacy fallback: no webhook_channels but webhook_enabled is set
            print("Sending webhook (legacy mode)...")
            try:
                wh_ok = send_webhook(draft, settings)
                if not wh_ok:
                    print("Warning: Webhook send failed")
            except Exception as e:
                print(f"Warning: Webhook error: {e}")

        print("Done!")
        return 0
    else:
        print("Email send failed")
        return 1


def run_full(settings: dict) -> int:
    """Legacy mode: fetch + send in one step."""
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        print("Error: ANTHROPIC_API_KEY not set")
        return 1

    topic = settings.get("news_topic", "AI")
    max_items = settings.get("max_news_items", 10)

    print("Fetching news...")
    news_data = fetch_news(anthropic_key, topic=topic, max_items=max_items, settings=settings)

    if news_data.get("error"):
        print(f"Warning: {news_data['error']}")

    categories = news_data.get("categories", [])
    total_news = sum(len(c.get("news", [])) for c in categories)
    print(f"Got {total_news} news items in {len(categories)} categories")

    if categories:
        for cat in categories:
            icon = cat.get("icon", "")
            name = cat.get("name", "")
            count = len(cat.get("news", []))
            print(f"   {icon} {name}: {count}")

    # Save draft
    save_draft(news_data, settings)

    # Format and send
    email_body = format_email_html(news_data, settings)
    email_subject = f"AI/科技新闻日报 - {news_data['date']}"
    print(f"HTML email generated ({len(email_body)} bytes)")

    print("Sending email...")
    success = send_email(subject=email_subject, body=email_body)

    if success:
        # Send webhook for each enabled channel
        channels = settings.get("webhook_channels", [])
        enabled_channels = [ch for ch in channels if ch.get("enabled", False)]

        if enabled_channels:
            for ch in enabled_channels:
                ch_name = ch.get("name", ch.get("id", "?"))
                print(f"Sending webhook to {ch_name}...")
                try:
                    wh_ok = send_webhook(news_data, settings, channel=ch)
                    if not wh_ok:
                        print(f"Warning: Webhook send failed for {ch_name}")
                except Exception as e:
                    print(f"Warning: Webhook error for {ch_name}: {e}")
        elif settings.get("webhook_enabled", False):
            print("Sending webhook (legacy)...")
            try:
                wh_ok = send_webhook(news_data, settings)
                if not wh_ok:
                    print("Warning: Webhook send failed")
            except Exception as e:
                print(f"Warning: Webhook error: {e}")

        print("Done!")
        return 0
    else:
        print("Email send failed")
        return 1


def _send_all_channels(settings: dict, date: str, channels: list) -> None:
    """Send webhook for each enabled channel using their respective drafts."""
    for ch in channels:
        ch_id = ch.get("id", "unknown")
        ch_name = ch.get("name", ch_id)

        ch_draft = load_draft(date, channel_id=ch_id)
        if not ch_draft:
            # Fall back to email draft if no channel-specific draft
            ch_draft = load_draft(date)
            if not ch_draft:
                print(f"Warning: No draft found for channel {ch_name}, skipping")
                continue

        status = ch_draft.get("status", "pending_review")
        if status == "rejected":
            print(f"Channel {ch_name}: draft rejected, skipping")
            continue

        print(f"Sending webhook to {ch_name}...")
        try:
            wh_ok = send_webhook(ch_draft, settings, channel=ch)
            if wh_ok:
                # Update channel draft status
                ch_draft["status"] = "sent"
                save_draft(ch_draft, settings, channel_id=ch_id)
                print(f"Channel {ch_name}: sent successfully")
            else:
                print(f"Warning: Webhook send failed for {ch_name}")
        except Exception as e:
            print(f"Warning: Webhook error for {ch_name}: {e}")


def run_webhook(settings: dict, date: str = None, channel_id: str = None) -> int:
    """Read draft and send webhook only (no email, no status change).

    Args:
        settings: Configuration dict
        date: Optional date string
        channel_id: If specified, only send to this channel. Otherwise send to all enabled.
    """
    tz = ZoneInfo(settings.get("timezone", "Asia/Shanghai"))
    if date is None:
        date = datetime.now(tz).strftime("%Y-%m-%d")

    channels = settings.get("webhook_channels", [])
    enabled_channels = [ch for ch in channels if ch.get("enabled", False)]

    if channel_id:
        # Send to specific channel only
        ch = next((c for c in channels if c.get("id") == channel_id), None)
        if not ch:
            print(f"Error: Channel '{channel_id}' not found in settings")
            return 1

        ch_draft = load_draft(date, channel_id=channel_id)
        if not ch_draft:
            # Fall back to email draft
            ch_draft = load_draft(date)
        if not ch_draft:
            print(f"Error: No draft found for {date} (channel={channel_id})")
            return 1

        ch_name = ch.get("name", channel_id)
        print(f"Sending webhook to {ch_name}...")
        try:
            wh_ok = send_webhook(ch_draft, settings, channel=ch)
            if wh_ok:
                print(f"Webhook sent to {ch_name} successfully!")
                return 0
            else:
                print(f"Webhook send failed for {ch_name}")
                return 1
        except Exception as e:
            print(f"Webhook error for {ch_name}: {e}")
            return 1

    elif enabled_channels:
        # Send to all enabled channels
        any_failed = False
        for ch in enabled_channels:
            ch_id_val = ch.get("id", "unknown")
            ch_name = ch.get("name", ch_id_val)

            ch_draft = load_draft(date, channel_id=ch_id_val)
            if not ch_draft:
                ch_draft = load_draft(date)
            if not ch_draft:
                print(f"Warning: No draft found for {ch_name}, skipping")
                any_failed = True
                continue

            status = ch_draft.get("status", "pending_review")
            if status == "rejected":
                print(f"Channel {ch_name}: draft rejected, skipping")
                continue

            print(f"Sending webhook to {ch_name}...")
            try:
                wh_ok = send_webhook(ch_draft, settings, channel=ch)
                if wh_ok:
                    print(f"Webhook sent to {ch_name} successfully!")
                else:
                    print(f"Webhook send failed for {ch_name}")
                    any_failed = True
            except Exception as e:
                print(f"Webhook error for {ch_name}: {e}")
                any_failed = True

        return 1 if any_failed else 0

    else:
        # Legacy fallback: no channels defined
        draft = load_draft(date)
        if not draft:
            print(f"Error: No draft found for {date}")
            return 1

        print("Sending webhook...")
        try:
            wh_ok = send_webhook(draft, settings)
            if wh_ok:
                print("Webhook sent successfully!")
                return 0
            else:
                print("Webhook send failed")
                return 1
        except Exception as e:
            print(f"Webhook error: {e}")
            return 1


def main():
    settings = load_settings()
    tz = ZoneInfo(settings.get("timezone", "Asia/Shanghai"))

    print(f"=== AI/科技新闻日报 ===")
    print(f"Time: {datetime.now(tz).strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print()

    # Determine mode from command line or environment
    mode = "full"
    if len(sys.argv) > 1:
        mode = sys.argv[1]
    else:
        mode = os.environ.get("RUN_MODE", "full")

    # Check for --manual flag
    manual_flag = "--manual" in sys.argv

    # Parse --channel <id> argument
    channel_id = None
    args = sys.argv[2:]
    i = 0
    date_arg = None
    while i < len(args):
        if args[i] == "--channel" and i + 1 < len(args):
            channel_id = args[i + 1]
            i += 2
        elif args[i] == "--manual":
            i += 1
        else:
            if date_arg is None:
                date_arg = args[i]
            i += 1

    if mode == "fetch":
        exit_code = run_fetch(settings, manual=manual_flag)
    elif mode == "send":
        exit_code = run_send(settings, date_arg)
    elif mode == "webhook":
        exit_code = run_webhook(settings, date_arg, channel_id=channel_id)
    else:
        exit_code = run_full(settings)

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
