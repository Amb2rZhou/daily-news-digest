#!/usr/bin/env python3
"""
Send news digest to group chat via RedCity webhook.
"""

import json
import os
import urllib.request
import urllib.error

# Default config path (relative to project root)
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "settings.json")


def _load_settings() -> dict:
    config_path = os.environ.get("SETTINGS_PATH", CONFIG_PATH)
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def format_webhook_markdown(news_data: dict) -> str:
    """Format draft JSON into markdown message for webhook."""
    date = news_data.get("date", "")
    categories = news_data.get("categories", [])
    time_window = news_data.get("time_window", "")

    lines = [f"AI/科技新闻日报 - {date}", ""]

    total_news = 0
    for cat in categories:
        icon = cat.get("icon", "")
        name = cat.get("name", "")
        news_items = cat.get("news", [])
        if not news_items:
            continue

        lines.append(f'<font color="warning">{icon} {name}</font>')
        for item in news_items:
            title = item.get("title", "")
            summary = item.get("summary", "")
            source = item.get("source", "")
            lines.append(f">{title} — {summary}")
            lines.append(f">来源: {source}")
            lines.append(">")
            total_news += 1
        lines.append("")

    lines.append(f"共 {total_news} 条新闻 | 时间窗口: {time_window}")

    return "\n".join(lines)


def send_webhook(news_data: dict, settings: dict = None) -> bool:
    """POST markdown message to RedCity webhook. Returns True on success."""
    if settings is None:
        settings = _load_settings()

    webhook_key = os.environ.get("WEBHOOK_KEY")
    if not webhook_key:
        print("Warning: WEBHOOK_KEY not set, skipping webhook")
        return False

    url_base = settings.get(
        "webhook_url_base",
        "https://redcity-open.xiaohongshu.com/api/robot/webhook/send",
    )
    url = f"{url_base}?key={webhook_key}"

    content = format_webhook_markdown(news_data)

    payload = {
        "msgtype": "markdown",
        "markdown": {
            "content": content,
            "mentioned_list": ["@all"],
        },
    }

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            print(f"Webhook response: {result}")
            return True
    except urllib.error.HTTPError as e:
        print(f"Webhook HTTP error: {e.code} {e.reason}")
        return False
    except Exception as e:
        print(f"Webhook error: {e}")
        return False


if __name__ == "__main__":
    # Standalone test: load today's draft and send via webhook
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from fetch_news import load_draft, load_settings

    settings = load_settings()
    date_arg = sys.argv[1] if len(sys.argv) > 1 else None
    draft = load_draft(date_arg)

    if not draft:
        print("No draft found")
        sys.exit(1)

    print("Formatted message preview:")
    print("---")
    print(format_webhook_markdown(draft))
    print("---")
    print()

    success = send_webhook(draft, settings)
    sys.exit(0 if success else 1)
