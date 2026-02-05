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

    lines = [f"# 科技日报 {date}"]

    total_news = 0
    for cat in categories:
        icon = cat.get("icon", "")
        name = cat.get("name", "")
        news_items = cat.get("news", [])
        if not news_items:
            continue

        # 分类标题（用分隔线制造视觉间隔）
        lines.append("───────────────")
        lines.append(f"## {icon} {name}")

        for item in news_items:
            title = item.get("title", "")
            summary = item.get("summary", "")
            comment = item.get("comment", "")
            url = item.get("url", "")

            # 标题
            lines.append(f"**{title}**")

            # 摘要
            if summary:
                lines.append(f"> {summary}")

            # 思考问题（绿色，不斜体）
            if comment:
                lines.append(f'> <font color="info">{comment}</font>')

            # 链接
            lines.append(f"[阅读原文]({url})")
            lines.append("")  # 条目间空行

            total_news += 1

    lines.append(f"---\n共 {total_news} 条")

    return "\n".join(lines)


def _get_webhook_key(channel: dict = None) -> str | None:
    """Resolve webhook key for the given channel.

    Resolution order:
    1. WEBHOOK_KEYS env var (JSON dict keyed by channel id)
    2. Fallback to WEBHOOK_KEY env var (legacy single-key)
    """
    webhook_keys_raw = os.environ.get("WEBHOOK_KEYS")
    channel_id = channel.get("id") if channel else None

    if webhook_keys_raw:
        try:
            keys = json.loads(webhook_keys_raw)
            if channel_id and channel_id in keys:
                return keys[channel_id]
            # If only one key in the dict, use it as fallback
            if len(keys) == 1:
                return next(iter(keys.values()))
        except (json.JSONDecodeError, TypeError):
            print("Warning: WEBHOOK_KEYS is not valid JSON, falling back to WEBHOOK_KEY")

    # Legacy fallback
    return os.environ.get("WEBHOOK_KEY")


def send_webhook(news_data: dict, settings: dict = None, channel: dict = None) -> bool:
    """POST markdown message to RedCity webhook. Returns True on success.

    Args:
        news_data: Draft data with categories
        settings: Global settings dict
        channel: Optional channel config dict. When provided, resolves webhook
                 key from WEBHOOK_KEYS JSON env var by channel id, and uses
                 the channel's webhook_url_base (falling back to global).
                 When None, uses legacy WEBHOOK_KEY env var.
    """
    if settings is None:
        settings = _load_settings()

    webhook_key = _get_webhook_key(channel)
    if not webhook_key:
        ch_label = channel.get("id", "?") if channel else "default"
        print(f"Warning: No webhook key found for channel '{ch_label}', skipping webhook")
        return False

    # Channel URL base takes priority, then global
    if channel:
        url_base = channel.get("webhook_url_base", "").strip() or settings.get(
            "webhook_url_base",
            "https://redcity-open.xiaohongshu.com/api/robot/webhook/send",
        )
    else:
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
            # Check API error code (0 = success)
            errcode = result.get("errcode", 0)
            if errcode != 0:
                errmsg = result.get("errmsg", "unknown error")
                print(f"Webhook API error: {errcode} - {errmsg}")
                return False
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
