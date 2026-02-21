#!/usr/bin/env python3
"""
Main script for daily news digest.
Supports modes:
  - fetch:     Fetch news, save as draft (for review)
  - send:      Read draft and send (email/webhook by channel type)
  - webhook:   Read draft and send webhook only (no email, no status change)
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


# ---------------------------------------------------------------------------
# Helper: truncate categories to max_items
# ---------------------------------------------------------------------------

def truncate_categories(categories: list[dict], max_items: int, balanced: bool = False) -> list[dict]:
    """Truncate news in categories to max_items total, preserving category structure.

    If balanced=True (focused mode), non-first categories keep all their items,
    and the first category (hardware) fills the remaining slots.
    This ensures all categories have content.
    """
    import copy
    total = sum(len(c.get("news", [])) for c in categories)
    if total <= max_items:
        return copy.deepcopy(categories)

    if balanced and len(categories) > 1:
        # Keep all items from non-first categories, cap the first category
        non_first_count = sum(len(c.get("news", [])) for c in categories[1:])
        first_max = max(1, max_items - non_first_count)
        result = []
        for i, cat in enumerate(categories):
            new_cat = copy.deepcopy(cat)
            if i == 0:
                new_cat["news"] = new_cat.get("news", [])[:first_max]
            if new_cat.get("news"):
                result.append(new_cat)
        return result

    # Default: sequential truncation
    result = []
    count = 0
    for cat in categories:
        new_cat = copy.deepcopy(cat)
        news = new_cat.get("news", [])
        remaining = max_items - count
        if remaining <= 0:
            break
        new_cat["news"] = news[:remaining]
        count += len(new_cat["news"])
        if new_cat["news"]:
            result.append(new_cat)
    return result


# ---------------------------------------------------------------------------
# Helper: channel selectors
# ---------------------------------------------------------------------------

def get_enabled_channels(settings: dict) -> list[dict]:
    """Return all enabled channels from settings."""
    return [ch for ch in settings.get("channels", []) if ch.get("enabled", False)]


def get_channels_to_fetch(settings: dict, now: datetime) -> list[dict]:
    """Return channels that need fetching.

    A channel needs fetching if current time >= fetch_time AND:
    - Draft doesn't exist for today, OR
    - Draft is stale (pending_review and created > 2 hours ago)
    """
    from datetime import timedelta
    from fetch_news import load_draft

    result = []
    today = now.strftime("%Y-%m-%d")

    for ch in get_enabled_channels(settings):
        ch_id = ch.get("id", "unknown")
        send_hour = ch.get("send_hour", 10)
        send_minute = ch.get("send_minute", 0)

        # Calculate fetch_time = send_time - 30 minutes
        send_time = now.replace(hour=send_hour, minute=send_minute, second=0, microsecond=0)
        fetch_time = send_time - timedelta(minutes=30)

        if now < fetch_time:
            continue

        # Check if draft exists
        if ch.get("type") == "email":
            draft = load_draft(today)
        else:
            draft = load_draft(today, channel_id=ch_id)

        if draft is None:
            result.append(ch)
        else:
            # Draft exists: check if stale (unreviewed and > 2 hours old)
            status = draft.get("status", "pending_review")
            created_at = draft.get("created_at", "")
            if status == "pending_review" and created_at:
                try:
                    created = datetime.fromisoformat(created_at)
                    hours_old = (now - created).total_seconds() / 3600
                    if hours_old > 2:
                        result.append(ch)
                except (ValueError, TypeError):
                    pass

    return result



# ---------------------------------------------------------------------------
# Mode: fetch
# ---------------------------------------------------------------------------

def run_fetch(settings: dict, manual: bool = False, channel_ids: list[str] = None) -> int:
    """Fetch news and save as draft for each channel that needs fetching.

    Steps:
    1. Determine which channels need fetching
    2. RSS fetch once
    3. Collect unique topic_modes, call Claude once per mode
    4. Save per-channel drafts (email draft = YYYY-MM-DD.json)
    """
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        print("Error: ANTHROPIC_API_KEY not set")
        return 1

    tz = ZoneInfo(settings.get("timezone", "Asia/Shanghai"))
    now = datetime.now(tz)

    # Determine channels to fetch
    if manual:
        channels = get_enabled_channels(settings)
    elif channel_ids:
        all_ch = {ch["id"]: ch for ch in settings.get("channels", [])}
        channels = [all_ch[cid] for cid in channel_ids if cid in all_ch]
    else:
        channels = get_channels_to_fetch(settings, now)

    if not channels:
        print("No channels need fetching at this time")
        return 0

    topic = settings.get("news_topic", "AI")

    # Collect all needed topic_modes and compute max_items per mode
    all_modes = set()
    max_items_by_mode = {}
    for ch in channels:
        mode = ch.get("topic_mode", "broad")
        all_modes.add(mode)
        ch_max = ch.get("max_news_items", 10)
        max_items_by_mode[mode] = max(max_items_by_mode.get(mode, 0), ch_max)

    # If any mode is focused, enable hardware_unlimited for RSS fetch
    hardware_unlimited = "focused" in all_modes

    # Use the largest max_news_items across ALL channels for the initial fetch
    max_items = max(max_items_by_mode.values())

    print(f"Fetching news... (manual={manual})")
    print(f"  - Channels to fetch: {[ch.get('name', ch.get('id')) for ch in channels]}")
    print(f"  - Unique modes needed: {all_modes}")

    # Use the earliest channel as reference for time window and topic_mode
    ref_channel = channels[0]
    ref_mode = ref_channel.get("topic_mode", "broad")
    # Pass topic_mode at top-level so summarize_news_with_claude picks it up
    ref_settings = {**settings, "topic_mode": ref_mode}
    news_data = fetch_news(
        anthropic_key, topic=topic, max_items=max_items,
        settings=ref_settings, manual=manual, hardware_unlimited=hardware_unlimited,
        channel=ref_channel,
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

    # Cache Claude results by topic_mode (ref_mode set above)
    mode_results = {ref_mode: categories}

    # Process each channel
    for ch in channels:
        ch_id = ch.get("id", "unknown")
        ch_mode = ch.get("topic_mode", "broad")
        ch_name = ch.get("name", ch_id)
        ch_max = ch.get("max_news_items", 10)
        print(f"\n--- Channel: {ch_name} (id={ch_id}, mode={ch_mode}) ---")

        if ch_mode in mode_results:
            ch_categories = mode_results[ch_mode]
            original_count = sum(len(c.get('news', [])) for c in ch_categories)
            print(f"  Reusing {ch_mode} mode result ({original_count} items)")
            # Truncate to this channel's max_news_items
            ch_categories = truncate_categories(ch_categories, ch_max, balanced=(ch_mode == "focused"))
            truncated_count = sum(len(c.get('news', [])) for c in ch_categories)
            if truncated_count < original_count:
                print(f"  Truncated to {truncated_count} items (max={ch_max})")
        else:
            if not raw_articles:
                print(f"  No raw articles available, skipping Claude call")
                ch_categories = []
            else:
                # Use the max_items for this mode (across all channels with this mode)
                mode_max = max_items_by_mode.get(ch_mode, ch_max)
                print(f"  Calling Claude for {ch_mode} mode (max={mode_max})...")
                ch_settings = {**settings, "topic_mode": ch_mode}
                ch_categories = summarize_news_with_claude(
                    anthropic_key, raw_articles, mode_max, ch_settings,
                )
                total = sum(len(c.get("news", [])) for c in ch_categories)
                print(f"  Got {total} items for {ch_mode} mode")
            # Store full result for other channels to reuse
            mode_results[ch_mode] = ch_categories
            # Truncate for this specific channel
            original_count = sum(len(c.get("news", [])) for c in ch_categories)
            ch_categories = truncate_categories(ch_categories, ch_max, balanced=(ch_mode == "focused"))
            truncated_count = sum(len(c.get("news", [])) for c in ch_categories)
            if truncated_count < original_count:
                print(f"  Truncated to {truncated_count} items for this channel (max={ch_max})")

        # Build draft data
        ch_draft = {
            "date": news_data.get("date"),
            "time_window": news_data.get("time_window"),
            "categories": ch_categories,
            "source": "manual" if manual else "scheduled",
        }

        # Email channel: save as YYYY-MM-DD.json (no channel_id suffix)
        if ch.get("type") == "email":
            draft_path = save_draft(ch_draft, settings)
        else:
            draft_path = save_draft(ch_draft, settings, channel_id=ch_id)
        print(f"  Draft saved: {draft_path}")

    return 0


# ---------------------------------------------------------------------------
# Mode: send
# ---------------------------------------------------------------------------

def run_send(settings: dict, date: str = None, channel_id: str = None) -> int:
    """Manually send specified channel(s).

    If channel_id is given, send that channel only.
    Otherwise send all enabled channels.
    """
    tz = ZoneInfo(settings.get("timezone", "Asia/Shanghai"))
    today = date or datetime.now(tz).strftime("%Y-%m-%d")

    channels = settings.get("channels", [])
    enabled = [ch for ch in channels if ch.get("enabled", False)]

    if channel_id:
        target = [ch for ch in channels if ch.get("id") == channel_id]
        if not target:
            print(f"Error: Channel '{channel_id}' not found in settings")
            return 1
        enabled = target

    any_failed = False
    for ch in enabled:
        ch_id = ch.get("id", "unknown")
        ch_type = ch.get("type", "webhook")
        ch_name = ch.get("name", ch_id)

        # Load draft (no fallback - each channel uses its own draft only)
        if ch_type == "email":
            draft = load_draft(today)
        else:
            draft = load_draft(today, channel_id=ch_id)

        if not draft:
            print(f"Warning: No draft found for {ch_name} on {today}, skipping")
            any_failed = True
            continue

        status = draft.get("status", "pending_review")
        if status in ("sent", "rejected"):
            print(f"Channel {ch_name}: draft {status}, skipping")
            continue

        print(f"Sending to {ch_name} (type={ch_type})...")

        if ch_type == "email":
            email_body = format_email_html(draft, settings)
            email_subject = f"AI/科技新闻日报 - {draft.get('date', today)}"
            success = send_email(subject=email_subject, body=email_body)
            if success:
                draft["status"] = "sent"
                save_draft(draft, settings)
                print(f"Channel {ch_name}: email sent successfully")
            else:
                print(f"Channel {ch_name}: email send failed")
                any_failed = True
        else:
            try:
                wh_ok = send_webhook(draft, settings, channel=ch)
                if wh_ok:
                    draft["status"] = "sent"
                    save_draft(draft, settings, channel_id=ch_id)
                    print(f"Channel {ch_name}: webhook sent successfully")
                else:
                    print(f"Channel {ch_name}: webhook send failed")
                    any_failed = True
            except Exception as e:
                print(f"Channel {ch_name}: webhook error: {e}")
                any_failed = True

    return 1 if any_failed else 0


# ---------------------------------------------------------------------------
# Mode: webhook only (manual, no status change)
# ---------------------------------------------------------------------------

def run_webhook(settings: dict, date: str = None, channel_id: str = None) -> int:
    """Read draft and send webhook only (no email, no status change)."""
    tz = ZoneInfo(settings.get("timezone", "Asia/Shanghai"))
    if date is None:
        date = datetime.now(tz).strftime("%Y-%m-%d")

    channels = settings.get("channels", [])
    webhook_channels = [ch for ch in channels if ch.get("type") == "webhook" and ch.get("enabled", False)]

    if channel_id:
        ch = next((c for c in channels if c.get("id") == channel_id), None)
        if not ch:
            print(f"Error: Channel '{channel_id}' not found in settings")
            return 1

        ch_draft = load_draft(date, channel_id=channel_id)
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

    elif webhook_channels:
        any_failed = False
        for ch in webhook_channels:
            ch_id_val = ch.get("id", "unknown")
            ch_name = ch.get("name", ch_id_val)

            ch_draft = load_draft(date, channel_id=ch_id_val)
            if not ch_draft:
                print(f"Warning: No draft found for {ch_name}, skipping")
                any_failed = True
                continue

            status = ch_draft.get("status", "pending_review")
            if status in ("sent", "rejected"):
                print(f"Channel {ch_name}: draft {status}, skipping")
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
        print("No webhook channels found")
        return 1


# ---------------------------------------------------------------------------
# Mode: full (legacy)
# ---------------------------------------------------------------------------

def run_full(settings: dict) -> int:
    """Legacy mode: fetch + send in one step."""
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        print("Error: ANTHROPIC_API_KEY not set")
        return 1

    topic = settings.get("news_topic", "AI")
    # Use email channel's max_items and topic_mode
    channels = settings.get("channels", [])
    email_ch = next((ch for ch in channels if ch.get("type") == "email"), {})
    max_items = email_ch.get("max_news_items", settings.get("max_news_items", 10))
    email_mode = email_ch.get("topic_mode", settings.get("topic_mode", "broad"))
    full_settings = {**settings, "topic_mode": email_mode}

    print("Fetching news...")
    news_data = fetch_news(anthropic_key, topic=topic, max_items=max_items, settings=full_settings)

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

    save_draft(news_data, settings)

    email_body = format_email_html(news_data, settings)
    email_subject = f"AI/科技新闻日报 - {news_data['date']}"
    print(f"HTML email generated ({len(email_body)} bytes)")

    print("Sending email...")
    success = send_email(subject=email_subject, body=email_body)

    if success:
        webhook_channels = [ch for ch in channels if ch.get("type") == "webhook" and ch.get("enabled", False)]
        for ch in webhook_channels:
            ch_name = ch.get("name", ch.get("id", "?"))
            print(f"Sending webhook to {ch_name}...")
            try:
                wh_ok = send_webhook(news_data, settings, channel=ch)
                if not wh_ok:
                    print(f"Warning: Webhook send failed for {ch_name}")
            except Exception as e:
                print(f"Warning: Webhook error for {ch_name}: {e}")

        print("Done!")
        return 0
    else:
        print("Email send failed")
        return 1


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

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
        exit_code = run_fetch(settings, manual=manual_flag, channel_ids=[channel_id] if channel_id else None)
    elif mode == "send":
        exit_code = run_send(settings, date_arg, channel_id=channel_id)
    elif mode == "webhook":
        exit_code = run_webhook(settings, date_arg, channel_id=channel_id)
    else:
        exit_code = run_full(settings)

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
