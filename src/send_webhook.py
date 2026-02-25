#!/usr/bin/env python3
"""
Send news digest to group chat via RedCity webhook.
"""

import json
import os
import urllib.request
import urllib.error
from typing import Optional

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


def _get_webhook_key(channel: dict = None) -> Optional[str]:
    """Resolve webhook key for the given channel.

    Resolution order:
    1. WEBHOOK_KEYS JSON env var (keyed by channel id)
    2. Fallback to legacy WEBHOOK_KEY_{slot} env var (backward compatible)
    """
    if not channel:
        return None

    ch_id = channel.get("id", "")

    # 1. Try WEBHOOK_KEYS JSON env var
    webhook_keys_json = os.environ.get("WEBHOOK_KEYS", "").strip()
    if webhook_keys_json:
        try:
            keys_map = json.loads(webhook_keys_json)
            key = keys_map.get(ch_id)
            if key:
                return key.strip()
        except (json.JSONDecodeError, AttributeError):
            print("Warning: WEBHOOK_KEYS env var is not valid JSON, falling back to slot-based keys")

    # 2. Fallback to legacy slot-based WEBHOOK_KEY_{slot}
    slot = channel.get("webhook_key_slot")
    if not slot:
        print(f"Warning: Channel '{ch_id or '?'}' has no webhook_key_slot configured")
        return None

    key = os.environ.get(f"WEBHOOK_KEY_{slot}")
    if key:
        return key.strip()

    print(f"Warning: webhook_key_slot={slot} configured but WEBHOOK_KEY_{slot} not set")
    return None


def _post_webhook(url: str, content: str, mentioned_list: list = None) -> str:
    """Post a single markdown message to webhook.

    Returns:
        "ok"          - success
        "api_error"   - server responded with errcode != 0 (safe to retry with smaller payload)
        "network_error" - network/timeout issue (NOT safe to retry, message may have been delivered)
    """
    if mentioned_list is None:
        mentioned_list = ["@all"]
    payload = {
        "msgtype": "markdown",
        "markdown": {
            "content": content,
            "mentioned_list": mentioned_list,
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
        with urllib.request.urlopen(req, timeout=60) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            print(f"Webhook response: {result}")
            errcode = result.get("errcode", 0)
            if errcode != 0:
                errmsg = result.get("errmsg", "unknown error")
                print(f"Webhook API error: {errcode} - {errmsg}")
                return "api_error"
            return "ok"
    except urllib.error.HTTPError as e:
        print(f"Webhook HTTP error: {e.code} {e.reason}")
        return "api_error"
    except Exception as e:
        print(f"Webhook network error: {e}")
        return "network_error"


def send_webhook(news_data: dict, settings: dict = None, channel: dict = None) -> bool:
    """POST markdown message to RedCity webhook. Returns True on success.

    Args:
        news_data: Draft data with categories
        settings: Global settings dict
        channel: Channel config dict with webhook_key_slot for key resolution.
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
    print(f"  Webhook message: {len(content.encode('utf-8'))} bytes")

    mentioned_list = channel.get("mentioned_list") if channel else None

    result = _post_webhook(url, content, mentioned_list=mentioned_list)
    if result == "ok":
        return True

    if result == "network_error":
        # Network errors (timeout, connection reset) may mean the server already
        # received and delivered the message. Do NOT retry to avoid duplicate.
        print("  Network error — skipping retry to avoid potential duplicate message")
        return False

    # API explicitly rejected (errcode != 0, e.g. message too large) — safe to retry
    import copy
    trimmed = copy.deepcopy(news_data)
    cats = trimmed.get("categories", [])
    original = sum(len(c.get("news", [])) for c in cats)

    while cats:
        # Remove last item from last non-empty category
        for i in range(len(cats) - 1, -1, -1):
            if cats[i].get("news"):
                cats[i]["news"].pop()
                if not cats[i]["news"]:
                    cats.pop(i)
                break
        else:
            break

        remaining = sum(len(c.get("news", [])) for c in cats)
        content = format_webhook_markdown(trimmed)
        print(f"  Retrying with {remaining}/{original} items ({len(content.encode('utf-8'))} bytes)")
        result = _post_webhook(url, content, mentioned_list=mentioned_list)
        if result == "ok":
            return True
        if result == "network_error":
            print("  Network error during retry — stopping to avoid duplicate")
            return False

    print("  All retry attempts failed")
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
