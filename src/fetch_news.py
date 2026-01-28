#!/usr/bin/env python3
"""
Fetch AI/Tech news using NewsAPI and summarize with Claude.
"""

import anthropic
import requests
import json
import os
from datetime import datetime, timedelta

NEWSAPI_BASE_URL = "https://newsapi.org/v2/everything"

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

def fetch_raw_news(newsapi_key: str, query: str = "artificial intelligence OR AI OR 人工智能") -> list[dict]:
    """Fetch raw news from NewsAPI."""

    # Calculate date range (last 24 hours)
    now = datetime.now()
    from_date = (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S")
    to_date = now.strftime("%Y-%m-%dT%H:%M:%S")

    params = {
        "q": query,
        "from": from_date,
        "to": to_date,
        "sortBy": "publishedAt",
        "language": "en",
        "pageSize": 50,
        "apiKey": newsapi_key
    }

    try:
        response = requests.get(NEWSAPI_BASE_URL, params=params, timeout=30)
        response.raise_for_status()
        data = response.json()

        if data.get("status") == "ok":
            return data.get("articles", [])
        else:
            print(f"NewsAPI error: {data.get('message', 'Unknown error')}")
            return []
    except Exception as e:
        print(f"Failed to fetch news: {e}")
        return []

def summarize_news_with_claude(anthropic_key: str, articles: list[dict], max_items: int = 10) -> list[dict]:
    """Use Claude to summarize and select top news."""

    if not articles:
        return []

    client = anthropic.Anthropic(api_key=anthropic_key)

    # Prepare articles for Claude
    articles_text = ""
    for i, article in enumerate(articles[:30], 1):  # Limit to 30 articles to avoid token limits
        title = article.get("title", "")
        description = article.get("description", "")
        source = article.get("source", {}).get("name", "Unknown")
        url = article.get("url", "")
        published = article.get("publishedAt", "")

        articles_text += f"""
---
Article {i}:
Title: {title}
Source: {source}
Published: {published}
Description: {description}
URL: {url}
"""

    prompt = f"""以下是最近24小时内的 AI/科技新闻列表。请帮我：

1. 筛选出最重要、最值得关注的新闻（最多 {max_items} 条）
2. 去重：相同事件的多篇报道只保留一条
3. 按重要性排序（全球影响 > 行业影响 > 区域影响）
4. 为每条新闻写一个简短的中文摘要（1-2句话）

新闻列表：
{articles_text}

请以 JSON 格式返回，结构如下：
{{
  "news": [
    {{
      "title": "新闻标题（中文）",
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
        print(f"Failed to summarize news: {e}")

    return []

def fetch_news(newsapi_key: str, anthropic_key: str, topic: str = "AI/科技", max_items: int = 10) -> dict:
    """Fetch and process news."""

    today = datetime.now().strftime("%Y-%m-%d")
    start_time, end_time = get_time_window(18)

    print("  - Fetching raw news from NewsAPI...")
    raw_articles = fetch_raw_news(newsapi_key)
    print(f"  - Got {len(raw_articles)} raw articles")

    if not raw_articles:
        return {
            "date": today,
            "time_window": f"{start_time} ~ {end_time}",
            "news": [],
            "error": "No articles fetched from NewsAPI"
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
    newsapi_key = os.environ.get("NEWSAPI_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    if not newsapi_key:
        print("Error: NEWSAPI_KEY environment variable not set")
        exit(1)
    if not anthropic_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set")
        exit(1)

    news_data = fetch_news(newsapi_key, anthropic_key)
    print(json.dumps(news_data, ensure_ascii=False, indent=2))
