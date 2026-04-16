#!/usr/bin/env python3
"""
RSS 聚合器 - GitHub Actions 每日在云上跑
输入：config/rss-feeds.json
输出：rss-outputs/YYYY-MM-DD.json
"""
import json
import os
import re
import time
from pathlib import Path
from datetime import datetime, timezone, timedelta

import feedparser

ROOT = Path(__file__).parent.parent
CONFIG = ROOT / "config" / "rss-feeds.json"
OUT_DIR = ROOT / "rss-outputs"
OUT_DIR.mkdir(exist_ok=True)

# 以北京时间为日期基准
NOW = datetime.now(timezone(timedelta(hours=8)))
TODAY = NOW.strftime("%Y-%m-%d")
OUT_FILE = OUT_DIR / f"{TODAY}.json"

# 时效窗口：只收最近 36 小时内的新闻（覆盖上游偶尔延迟推送）
CUTOFF = datetime.utcnow() - timedelta(hours=36)


def load_config():
    with open(CONFIG, "r", encoding="utf-8") as f:
        return json.load(f)


def entry_pub_time(entry):
    for key in ("published_parsed", "updated_parsed"):
        t = entry.get(key)
        if t:
            try:
                return datetime(*t[:6])
            except Exception:
                pass
    return None


def matches_keywords(title, summary, keywords):
    blob = f"{title} {summary}".lower()
    return any(kw.lower() in blob for kw in keywords)


def main():
    cfg = load_config()
    all_items = []
    stats = {}

    for feed in cfg["feeds"]:
        name = feed["name"]
        url = feed["url"]
        print(f"→ {name} ({url})")
        try:
            parsed = feedparser.parse(url, agent="Mozilla/5.0 RSS Aggregator")
            if parsed.bozo and not parsed.entries:
                stats[name] = {"status": "fail", "error": str(parsed.bozo_exception)}
                continue
        except Exception as e:
            stats[name] = {"status": "fail", "error": str(e)}
            continue

        matched = 0
        for entry in parsed.entries:
            title = entry.get("title", "").strip()
            link = entry.get("link", "").strip()
            summary = re.sub(r"<[^>]+>", "", entry.get("summary", "")).strip()[:800]
            if not title or not link:
                continue

            # 时效过滤
            pub = entry_pub_time(entry)
            if pub and pub < CUTOFF:
                continue

            # 关键词过滤
            keywords = cfg["keywords_product"] + cfg["keywords_industry"]
            if not matches_keywords(title, summary, keywords):
                continue

            all_items.append({
                "feed_name": name,
                "feed_category": feed.get("category", ""),
                "feed_weight": feed.get("weight", 1),
                "title": title,
                "summary": summary[:500],
                "url": link,
                "published": pub.isoformat() if pub else None,
            })
            matched += 1

        stats[name] = {"status": "ok", "total": len(parsed.entries), "matched": matched}

    # 按 URL 去重
    seen = set()
    dedup = []
    for it in all_items:
        if it["url"] not in seen:
            seen.add(it["url"])
            dedup.append(it)

    # 按发布时间倒序
    dedup.sort(key=lambda x: x["published"] or "", reverse=True)

    output = {
        "date": TODAY,
        "generated_at": NOW.isoformat(),
        "item_count": len(dedup),
        "feed_stats": stats,
        "items": dedup,
    }

    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Wrote {OUT_FILE} ({len(dedup)} items)")
    print(f"Feed stats: {json.dumps(stats, ensure_ascii=False, indent=2)}")


if __name__ == "__main__":
    main()
