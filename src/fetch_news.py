#!/usr/bin/env python3
"""
Fetch AI/Tech news using RSS feeds and summarize with Claude.
"""

import anthropic
import feedparser
import json
import os
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed

# AI/Tech RSS feeds from authoritative sources
RSS_FEEDS = [
    # English sources
    "https://techcrunch.com/feed/",
    "https://www.theverge.com/rss/index.xml",
    "https://feeds.arstechnica.com/arstechnica/technology-lab",
    "https://www.wired.com/feed/rss",
    "https://venturebeat.com/feed/",
    "https://feeds.feedburner.com/TechCrunch/artificial-intelligence",
    "https://www.technologyreview.com/feed/",
    # Chinese sources
    "https://36kr.com/feed",
    "https://www.jiqizhixin.com/rss",
    "https://www.leiphone.com/feed",
]

def get_time_window(send_hour: int = 18) -> tuple[str, str]:
    """Calculate the news time window based on send time."""
    now = datetime.now()
    end_time = now.replace(hour=send_hour, minute=0, second=0, microsecond=0)

    if now.hour < send_hour:
        end_time = end_time - timedelta(days=1)

    start_time = end_time - timedelta(days=1)

    return (
        start_time.strftime("%Y-%m-%d %H:%M"),
        (end_time - timedelta(minutes=1)).strftime("%Y-%m-%d %H:%M")
    )

def parse_feed(feed_url: str, hours_ago: int = 24) -> list[dict]:
    """Parse a single RSS feed and return recent articles."""
    articles = []
    cutoff_time = datetime.now() - timedelta(hours=hours_ago)

    try:
        feed = feedparser.parse(feed_url)
        source_name = feed.feed.get("title", feed_url)

        for entry in feed.entries[:20]:  # Limit entries per feed
            # Parse published time
            published = None
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                published = datetime(*entry.published_parsed[:6])
            elif hasattr(entry, "updated_parsed") and entry.updated_parsed:
                published = datetime(*entry.updated_parsed[:6])

            # Skip if too old or no date
            if published and published < cutoff_time:
                continue

            articles.append({
                "title": entry.get("title", ""),
                "description": entry.get("summary", entry.get("description", ""))[:500],
                "source": source_name,
                "url": entry.get("link", ""),
                "published": published.isoformat() if published else ""
            })
    except Exception as e:
        print(f"  Warning: Failed to parse {feed_url}: {e}")

    return articles

def fetch_raw_news(hours_ago: int = 24) -> list[dict]:
    """Fetch raw news from multiple RSS feeds in parallel."""
    all_articles = []

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(parse_feed, url, hours_ago): url for url in RSS_FEEDS}

        for future in as_completed(futures):
            try:
                articles = future.result()
                all_articles.extend(articles)
            except Exception as e:
                print(f"  Warning: Feed error: {e}")

    # Sort by published time (newest first)
    all_articles.sort(key=lambda x: x.get("published", ""), reverse=True)

    return all_articles

def summarize_news_with_claude(anthropic_key: str, articles: list[dict], max_items: int = 10) -> list[dict]:
    """Use Claude to summarize and select top news."""

    if not articles:
        return []

    client = anthropic.Anthropic(api_key=anthropic_key)

    # Prepare articles for Claude
    articles_text = ""
    for i, article in enumerate(articles[:50], 1):  # Limit to 50 articles
        articles_text += f"""
---
Article {i}:
Title: {article.get('title', '')}
Source: {article.get('source', '')}
Published: {article.get('published', '')}
Description: {article.get('description', '')}
URL: {article.get('url', '')}
"""

    prompt = f"""以下是最近24小时内的 AI/科技新闻列表。请帮我：

1. 筛选出最重要、最值得关注的新闻（最多 {max_items} 条）
2. 去重：相同事件的多篇报道只保留一条（保留最权威来源）
3. 按重要性排序（全球影响 > 行业影响 > 区域影响）
4. 为每条新闻写一个简短的中文摘要（1-2句话）

新闻列表：
{articles_text}

请以 JSON 格式返回，结构如下：
{{
  "news": [
    {{
      "title": "新闻标题（中文翻译）",
      "summary": "1-2句中文摘要",
      "source": "来源名称",
      "url": "来源链接"
    }}
  ]
}}

只返回 JSON，不要其他文字。"""

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}]
        )

        response_text = response.content[0].text

        # Extract JSON from response
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}') + 1
        if start_idx != -1 and end_idx > start_idx:
            json_str = response_text[start_idx:end_idx]
            result = json.loads(json_str)
            return result.get("news", [])
    except Exception as e:
        print(f"  Error: Failed to summarize news: {e}")

    return []

def fetch_news(anthropic_key: str, topic: str = "AI/科技", max_items: int = 10) -> dict:
    """Fetch and process news."""

    today = datetime.now().strftime("%Y-%m-%d")
    start_time, end_time = get_time_window(18)

    print("  - Fetching news from RSS feeds...")
    raw_articles = fetch_raw_news(hours_ago=24)
    print(f"  - Got {len(raw_articles)} raw articles")

    if not raw_articles:
        return {
            "date": today,
            "time_window": f"{start_time} ~ {end_time}",
            "news": [],
            "error": "No articles fetched from RSS feeds"
        }

    print("  - Summarizing with Claude...")
    news = summarize_news_with_claude(anthropic_key, raw_articles, max_items)
    print(f"  - Selected {len(news)} top news")

    return {
        "date": today,
        "time_window": f"{start_time} ~ {end_time}",
        "news": news
    }

def format_email_body(news_data: dict) -> str:
    """Format news data into email body."""
    lines = [
        f"AI/科技新闻日报 - {news_data['date']}",
        "",
        f"时间窗口: {news_data['time_window']}",
        "",
        "---",
        ""
    ]

    if not news_data.get("news"):
        lines.append("今日暂无重要新闻。")
    else:
        for i, item in enumerate(news_data["news"], 1):
            lines.append(f"{i}. {item.get('title', '')}")
            lines.append(f"   {item.get('summary', '')}")
            lines.append(f"   链接: {item.get('url', '')}")
            lines.append("")

    lines.extend([
        "---",
        "由 AI News Assistant 自动生成"
    ])

    return "\n".join(lines)

if __name__ == "__main__":
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    if not anthropic_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set")
        exit(1)

    news_data = fetch_news(anthropic_key)
    print(json.dumps(news_data, ensure_ascii=False, indent=2))
