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
    # ===== AI/科技专业媒体 (英文) =====
    "https://techcrunch.com/feed/",
    "https://www.theverge.com/rss/index.xml",
    "https://feeds.arstechnica.com/arstechnica/technology-lab",
    "https://www.wired.com/feed/rss",
    "https://venturebeat.com/feed/",
    "https://www.technologyreview.com/feed/",
    "https://feeds.feedburner.com/TechCrunch/artificial-intelligence",
    # AI 公司官方博客
    "https://openai.com/blog/rss.xml",
    "https://blog.google/technology/ai/rss/",
    "https://ai.meta.com/blog/rss/",
    "https://www.anthropic.com/rss.xml",
    # 技术社区
    "https://hnrss.org/frontpage",  # Hacker News
    "https://www.reddit.com/r/MachineLearning/.rss",
    "https://www.reddit.com/r/artificial/.rss",

    # ===== 中文科技媒体 =====
    "https://36kr.com/feed",
    "https://www.jiqizhixin.com/rss",  # 机器之心
    "https://www.leiphone.com/feed",   # 雷锋网
    "https://www.huxiu.com/rss/0.xml", # 虎嗅
    "https://www.tmtpost.com/feed",    # 钛媒体
    "https://www.pingwest.com/feed",   # PingWest品玩
    "https://www.ifanr.com/feed",      # 爱范儿
    "https://sspai.com/feed",          # 少数派
    "https://www.geekpark.net/rss",    # 极客公园

    # ===== 国际主流媒体科技频道 =====
    "https://feeds.reuters.com/reuters/technologyNews",
    "https://feeds.bbci.co.uk/news/technology/rss.xml",
    "http://rss.cnn.com/rss/cnn_tech.rss",
    "https://www.cnbc.com/id/19854910/device/rss/rss.html",  # CNBC Tech
    "https://feeds.bloomberg.com/technology/news.rss",
    "https://www.ft.com/technology?format=rss",  # Financial Times Tech

    # ===== B站 UP主 (通过 RSSHub) =====
    "https://rsshub.app/bilibili/user/video/612932327",   # 老石谈芯 (硬件/芯片)
    "https://rsshub.app/bilibili/user/video/266765166",   # 漫士沉思录 (AI/数学科普)
    "https://rsshub.app/bilibili/user/video/517221395",   # ZOMI酱 (AI系统/框架)
    "https://rsshub.app/bilibili/user/video/504715181",   # 王木头学科学 (深度学习)

    # ===== 播客 (通过 RSSHub 或官方 RSS) =====
    "https://rsshub.app/ximalaya/album/51487187",         # 硅谷101
    "https://rsshub.app/ximalaya/album/29161862",         # OnBoard!
    "https://rsshub.app/ximalaya/album/3558668",          # 42章经

    # ===== 技术博客/Newsletter =====
    "https://github.blog/feed/",                          # GitHub Blog
    "https://a16z.com/feed/",                             # a16z (Andreessen Horowitz)

    # ===== 微信公众号 (通过第三方 RSS 服务) =====
    # -- 已找到 RSS 的公众号 --
    "https://wechat2rss.xlab.app/feed/a1cd365aa14ed7d64cabfc8aa086da40ecaba34d.xml",  # 夕小瑶科技说
    "https://wechat2rss.xlab.app/feed/9685937b45fe9c7a526dbc32e4f24ba879a65b9a.xml",  # 腾讯技术工程
    "https://feed.hamibot.com/api/feeds/6131b5301269c358aa0dec25",  # 白鲸出海
    "https://feed.hamibot.com/api/feeds/6121d8a451e2511a8279faaf",  # 晚点LatePost
    "https://feed.hamibot.com/api/feeds/613570931269c358aa0f0cca",  # 海外独角兽

    # ===== 独立博客/网站 =====
    "https://baoyu.io/feed.xml",                                    # 宝玉AI
    "https://www.latepost.com/rss",                                 # 晚点LatePost官网

    # ===== 待添加的公众号 =====
    # 以下公众号暂无公开 RSS，需要通过 WeWe RSS (基于微信读书) 自建获取：
    # https://github.com/cooderl/wewe-rss
    #
    # 腾讯研究院、AGI Hunt、腾讯科技、Web3天空之城、老刘说NLP、
    # founder park、AI炼金术、十字路口crossing、归藏的AI工具箱
    #
    # 获取到 RSS 链接后，在此处添加即可。
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

CATEGORIES = [
    {"name": "技术进展", "icon": "🔬"},
    {"name": "产品发布", "icon": "🚀"},
    {"name": "投融资", "icon": "💰"},
    {"name": "巨头动向", "icon": "🏢"},
    {"name": "行业观察", "icon": "📊"},
    {"name": "开源与开发者", "icon": "👨‍💻"},
]

def summarize_news_with_claude(anthropic_key: str, articles: list[dict], max_items: int = 10) -> list[dict]:
    """Use Claude to summarize, categorize, and select top news."""

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

    category_names = "、".join(c["name"] for c in CATEGORIES)
    category_json_example = json.dumps(
        [{"name": c["name"], "icon": c["icon"], "news": [{"title": "...", "summary": "...", "source": "...", "url": "..."}]} for c in CATEGORIES[:2]],
        ensure_ascii=False, indent=4
    )

    prompt = f"""以下是最近24小时内的 AI/科技新闻列表。请帮我：

1. 筛选出最重要、最值得关注的新闻（最多 {max_items} 条）
2. 去重：相同事件的多篇报道只保留一条（保留最权威来源）
3. 按重要性排序（全球影响 > 行业影响 > 区域影响）
4. 为每条新闻写一个简短的中文摘要（1-2句话）
5. 将新闻按以下类别分组：{category_names}
   - 每条新闻只归入一个最匹配的类别
   - 没有对应新闻的类别不要输出

重要：摘要和标题中不要使用双引号，用单引号或其他标点代替。

新闻列表：
{articles_text}

请以 JSON 格式返回，结构如下：
{{
  "categories": {category_json_example}
}}

注意：
- 只返回有新闻的类别
- icon 必须与类别对应（技术进展:🔬 产品发布:🚀 投融资:💰 巨头动向:🏢 行业观察:📊 开源与开发者:👨‍💻）
- 只返回合法的 JSON，不要其他文字
- 确保所有字符串中的双引号用单引号替换"""

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
            try:
                result = json.loads(json_str)
            except json.JSONDecodeError:
                # Fix common JSON issues: unescaped quotes in values
                import re
                # Remove control characters
                json_str = re.sub(r'[\x00-\x1f\x7f]', ' ', json_str)
                json_str = json_str.replace('\\"', '"')  # normalize
                lines = json_str.split('\n')
                fixed_lines = []
                for line in lines:
                    m = re.match(r'^(\s*"(?:title|summary|source|url|name|icon)":\s*")(.*)(",?\s*)$', line)
                    if m:
                        value = m.group(2).replace('"', "'")
                        line = m.group(1) + value + m.group(3)
                    fixed_lines.append(line)
                json_str = '\n'.join(fixed_lines)
                result = json.loads(json_str)
            return result.get("categories", [])
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
            "categories": [],
            "error": "No articles fetched from RSS feeds"
        }

    print("  - Summarizing with Claude...")
    categories = summarize_news_with_claude(anthropic_key, raw_articles, max_items)
    total = sum(len(c.get("news", [])) for c in categories)
    print(f"  - Selected {total} top news in {len(categories)} categories")

    return {
        "date": today,
        "time_window": f"{start_time} ~ {end_time}",
        "categories": categories
    }

def format_email_html(news_data: dict) -> str:
    """Format news data into a beautiful HTML email."""
    date = news_data.get("date", "")
    time_window = news_data.get("time_window", "")
    categories = news_data.get("categories", [])

    # Build category sections
    sections_html = ""
    if not categories:
        sections_html = '<tr><td style="padding:20px 30px;color:#666;font-size:16px;">今日暂无重要新闻。</td></tr>'
    else:
        for cat in categories:
            icon = cat.get("icon", "📰")
            name = cat.get("name", "")
            news_items = cat.get("news", [])

            cards_html = ""
            for item in news_items:
                title = item.get("title", "")
                summary = item.get("summary", "")
                source = item.get("source", "")
                url = item.get("url", "#")

                cards_html += f'''<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
<tr><td style="background:#ffffff;border-radius:8px;border:1px solid #e8e8e8;padding:16px 20px;">
  <a href="{url}" style="color:#1a1a2e;text-decoration:none;font-size:15px;font-weight:600;line-height:1.4;display:block;" target="_blank">{title}</a>
  <p style="color:#555;font-size:14px;line-height:1.6;margin:8px 0 10px 0;">{summary}</p>
  <span style="display:inline-block;background:#eef2ff;color:#4f46e5;font-size:12px;padding:2px 10px;border-radius:12px;">{source}</span>
</td></tr>
</table>'''

            sections_html += f'''<tr><td style="padding:24px 30px 8px 30px;">
  <h2 style="margin:0 0 16px 0;font-size:18px;color:#1a1a2e;font-weight:700;">{icon} {name}</h2>
  {cards_html}
</td></tr>'''

    html = f'''<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0f2f5;">
<tr><td align="center" style="padding:24px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

<!-- Header -->
<tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:32px 30px;text-align:center;">
  <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:1px;">AI / 科技新闻日报</h1>
  <p style="margin:10px 0 0 0;color:rgba(255,255,255,0.75);font-size:14px;">{date} &nbsp;|&nbsp; {time_window}</p>
</td></tr>

<!-- News Sections -->
{sections_html}

<!-- Footer -->
<tr><td style="padding:20px 30px;border-top:1px solid #eee;text-align:center;">
  <p style="margin:0;color:#999;font-size:12px;">由 AI News Assistant 自动生成 &nbsp;&middot;&nbsp; Powered by Claude</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>'''

    return html

if __name__ == "__main__":
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    if not anthropic_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set")
        exit(1)

    news_data = fetch_news(anthropic_key)
    print(json.dumps(news_data, ensure_ascii=False, indent=2))
