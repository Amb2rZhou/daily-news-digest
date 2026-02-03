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

from fetch_news import fetch_news, format_email_html, save_draft, load_draft, load_settings
from send_email import send_email
from send_webhook import send_webhook


def run_fetch(settings: dict, manual: bool = False) -> int:
    """Fetch news and save as draft.

    Args:
        settings: Configuration dict
        manual: If True, use current time as window end (manual trigger)
                If False, use scheduled send time as window end (auto trigger)
    """
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
    if not anthropic_key:
        print("Error: ANTHROPIC_API_KEY not set")
        return 1

    topic = settings.get("news_topic", "AI")
    max_items = settings.get("max_news_items", 10)

    print(f"Fetching news... (manual={manual})")
    news_data = fetch_news(anthropic_key, topic=topic, max_items=max_items, settings=settings, manual=manual)

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

    draft_path = save_draft(news_data, settings)
    print(f"Draft saved: {draft_path}")
    return 0


def run_send(settings: dict, date: str = None) -> int:
    """Read draft and send email."""
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

        # Send webhook notification
        if settings.get("webhook_enabled", False):
            print("Sending webhook...")
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
        # Send webhook notification
        if settings.get("webhook_enabled", False):
            print("Sending webhook...")
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


def run_webhook(settings: dict, date: str = None) -> int:
    """Read draft and send webhook only (no email, no status change)."""
    draft = load_draft(date)
    if not draft:
        tz = ZoneInfo(settings.get("timezone", "Asia/Shanghai"))
        today = date or datetime.now(tz).strftime("%Y-%m-%d")
        print(f"Error: No draft found for {today}")
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

    # Get date arg (skip --manual)
    date_arg = None
    for arg in sys.argv[2:]:
        if arg != "--manual":
            date_arg = arg
            break

    if mode == "fetch":
        exit_code = run_fetch(settings, manual=manual_flag)
    elif mode == "send":
        exit_code = run_send(settings, date_arg)
    elif mode == "webhook":
        exit_code = run_webhook(settings, date_arg)
    else:
        exit_code = run_full(settings)

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
