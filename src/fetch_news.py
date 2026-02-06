#!/usr/bin/env python3
"""
Fetch AI/Tech news using RSS feeds and summarize with Claude.
"""

import anthropic
import feedparser
import json
import os
import requests
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from concurrent.futures import ThreadPoolExecutor, as_completed

# Fallback RSS feeds (used when settings.json has no rss_feeds)
DEFAULT_RSS_FEEDS = [
    "https://techcrunch.com/feed/",
    "https://www.theverge.com/rss/index.xml",
    "https://feeds.arstechnica.com/arstechnica/technology-lab",
    "https://www.wired.com/feed/rss",
    "https://venturebeat.com/feed/",
    "https://www.technologyreview.com/feed/",
    "https://openai.com/blog/rss.xml",
    "https://blog.google/technology/ai/rss/",
    "https://ai.meta.com/blog/rss/",
    "https://www.anthropic.com/rss.xml",
    "https://hnrss.org/frontpage",
    "https://www.reddit.com/r/MachineLearning/.rss",
    "https://36kr.com/feed",
    "https://www.jiqizhixin.com/rss",
    "https://www.huxiu.com/rss/0.xml",
    "https://www.tmtpost.com/feed",
    "https://www.pingwest.com/feed",
    "https://www.geekpark.net/rss",
    "https://github.blog/feed/",
    "https://a16z.com/feed/",
]

def get_rss_feeds(settings: dict = None) -> list[str]:
    """Get RSS feed URLs from settings (enabled only), with fallback to defaults."""
    if settings is None:
        settings = load_settings()
    rss_feeds = settings.get("rss_feeds", [])
    if rss_feeds:
        return [f["url"] for f in rss_feeds if f.get("enabled", True)]
    return DEFAULT_RSS_FEEDS

# Default config path (relative to project root)
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "settings.json")

def load_settings() -> dict:
    """Load settings from config/settings.json.

    Backward-compatible: auto-migrates old formats to the new unified
    ``channels`` array.  Supports three legacy shapes:

    1. ``webhook_channels`` present (no ``channels``)  → convert
    2. ``webhook_enabled`` present (no ``webhook_channels``, no ``channels``) → convert
    3. Only top-level ``send_hour``/``send_minute``/``topic_mode``/``max_news_items`` → convert
    """
    defaults = {
        "timezone": "Asia/Shanghai",
        "categories_order": ["产品发布", "巨头动向", "技术进展", "行业观察", "投融资"],
        "filters": {
            "blacklist_keywords": [],
            "blacklist_sources": [],
            "whitelist_keywords": [],
            "whitelist_sources": []
        }
    }
    config_path = os.environ.get("SETTINGS_PATH", CONFIG_PATH)
    try:
        with open(config_path, "r", encoding="utf-8") as f:
            settings = json.load(f)
        # Merge with defaults for any missing keys
        for k, v in defaults.items():
            settings.setdefault(k, v)

        # --- Backward-compatible migration to unified channels ---
        if "channels" not in settings:
            send_hour = settings.get("send_hour", 18)
            send_minute = settings.get("send_minute", 0)
            topic_mode = settings.get("topic_mode", "broad")
            max_items = settings.get("max_news_items", 10)

            channels = []

            # Email channel (always present)
            channels.append({
                "id": "email",
                "type": "email",
                "name": "邮件",
                "enabled": True,
                "send_hour": send_hour,
                "send_minute": send_minute,
                "topic_mode": topic_mode,
                "max_news_items": max_items,
            })

            # Migrate webhook_channels or webhook_enabled
            if "webhook_channels" in settings:
                for ch in settings["webhook_channels"]:
                    channels.append({
                        "id": ch.get("id", "default"),
                        "type": "webhook",
                        "name": ch.get("name", "默认群"),
                        "enabled": ch.get("enabled", False),
                        "send_hour": send_hour,
                        "send_minute": send_minute,
                        "topic_mode": ch.get("topic_mode", topic_mode),
                        "max_news_items": max_items,
                        "webhook_url_base": ch.get("webhook_url_base", ""),
                    })
            elif settings.get("webhook_enabled", False):
                channels.append({
                    "id": "default",
                    "type": "webhook",
                    "name": "默认群",
                    "enabled": True,
                    "send_hour": send_hour,
                    "send_minute": send_minute,
                    "topic_mode": topic_mode,
                    "max_news_items": max_items,
                    "webhook_url_base": "",
                })

            settings["channels"] = channels

        return settings
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"  Warning: Could not load settings from {config_path}: {e}")
        return defaults

CATEGORY_ICONS = {
    # 聚焦模式的 3 个分类
    "智能硬件": "🥽",
    "AI技术与产品": "🤖",
    "巨头动向与行业观察": "🏢",
    # 泛 AI 模式的 5 个分类（保留兼容）
    "产品发布": "🚀",
    "巨头动向": "🏢",
    "技术进展": "🔬",
    "行业观察": "📊",
    "投融资": "💰",
}

def get_categories(settings: dict = None) -> list[dict]:
    """Get ordered category list from settings."""
    if settings is None:
        settings = load_settings()
    order = settings.get("categories_order", list(CATEGORY_ICONS.keys()))
    return [{"name": name, "icon": CATEGORY_ICONS.get(name, "📰")} for name in order if name in CATEGORY_ICONS]

def get_time_window(settings: dict = None, manual: bool = False, channel: dict = None) -> tuple[str, str]:
    """Calculate the news time window.

    Args:
        settings: Configuration dict
        manual: If True, window ends at current time (for manual trigger)
                If False, window ends at scheduled send time (for auto trigger)
        channel: Optional channel dict – uses its send_hour/send_minute if given.

    Returns:
        Tuple of (start_time, end_time) as formatted strings
    """
    if settings is None:
        settings = load_settings()

    if channel:
        send_hour = channel.get("send_hour", 18)
        send_minute = channel.get("send_minute", 0)
    else:
        # Fallback: use the first channel's time, or defaults
        channels = settings.get("channels", [])
        first = channels[0] if channels else {}
        send_hour = first.get("send_hour", settings.get("send_hour", 18))
        send_minute = first.get("send_minute", settings.get("send_minute", 0))

    tz_name = settings.get("timezone", "Asia/Shanghai")
    tz = ZoneInfo(tz_name)

    now = datetime.now(tz)

    if manual:
        # Manual trigger: window ends at current time
        end_time = now
    else:
        # Auto trigger: window ends at scheduled send time
        today_send = now.replace(hour=send_hour, minute=send_minute, second=0, microsecond=0)
        if now < today_send:
            end_time = today_send - timedelta(days=1)
        else:
            end_time = today_send

    start_time = end_time - timedelta(days=1)

    return (
        start_time.strftime("%Y-%m-%d %H:%M"),
        (end_time - timedelta(seconds=1)).strftime("%Y-%m-%d %H:%M")
    )

def get_cutoff_time(settings: dict = None, manual: bool = False, channel: dict = None) -> datetime:
    """Get the cutoff time for filtering articles.

    Args:
        settings: Configuration dict
        manual: If True, cutoff is 24h before now (for manual trigger)
                If False, cutoff is 24h before scheduled send time (for auto trigger)
        channel: Optional channel dict – uses its send_hour/send_minute if given.
    """
    if settings is None:
        settings = load_settings()
    tz_name = settings.get("timezone", "Asia/Shanghai")
    tz = ZoneInfo(tz_name)

    if channel:
        send_hour = channel.get("send_hour", 18)
        send_minute = channel.get("send_minute", 0)
    else:
        channels = settings.get("channels", [])
        first = channels[0] if channels else {}
        send_hour = first.get("send_hour", settings.get("send_hour", 18))
        send_minute = first.get("send_minute", settings.get("send_minute", 0))

    now = datetime.now(tz)

    if manual:
        # Manual trigger: 24h before now
        return (now - timedelta(days=1)).replace(tzinfo=None)
    else:
        # Auto trigger: 24h before scheduled send time
        today_send = now.replace(hour=send_hour, minute=send_minute, second=0, microsecond=0)
        if now < today_send:
            return (today_send - timedelta(days=2)).replace(tzinfo=None)
        else:
            return (today_send - timedelta(days=1)).replace(tzinfo=None)

def parse_feed(feed_url: str, cutoff: datetime = None) -> list[dict]:
    """Parse a single RSS feed and return recent articles."""
    articles = []
    if cutoff is None:
        cutoff = datetime.now() - timedelta(hours=24)

    try:
        # Use requests to fetch content first (handles SSL better than feedparser's urllib)
        try:
            resp = requests.get(feed_url, timeout=15, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            feed = feedparser.parse(resp.content)
        except requests.RequestException:
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
            if published and published < cutoff:
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

def fetch_raw_news(cutoff: datetime = None, settings: dict = None, max_per_source: int = 3, hardware_unlimited: bool = False) -> list[dict]:
    """Fetch raw news from multiple RSS feeds in parallel.

    Args:
        cutoff: Only include articles published after this time
        settings: Settings dict
        max_per_source: Maximum articles to keep per source (ensures diversity)
        hardware_unlimited: If True, smart hardware sources are not limited (only for focused mode)
    """
    if settings is None:
        settings = load_settings()

    all_articles = []
    feed_urls = get_rss_feeds(settings)
    print(f"  - Using {len(feed_urls)} RSS feeds")

    # 获取智能硬件源的名称列表（仅聚焦模式下不受限制）
    hardware_sources = set()
    if hardware_unlimited:
        rss_feeds = settings.get("rss_feeds", [])
        for feed in rss_feeds:
            if feed.get("group") == "智能硬件" and feed.get("enabled", True):
                hardware_sources.add(feed.get("name", ""))
        print(f"  - Smart hardware sources (no limit): {list(hardware_sources)}")

    # Collect articles grouped by source
    articles_by_source = {}

    failed_feeds = []
    timeout_feeds = []
    empty_feeds = []

    import time
    rss_start = time.time()

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(parse_feed, url, cutoff): url for url in feed_urls}

        for future in as_completed(futures):
            url = futures[future]
            try:
                articles = future.result()
                if not articles:
                    empty_feeds.append(url)
                for article in articles:
                    source = article.get("source", "unknown")
                    if source not in articles_by_source:
                        articles_by_source[source] = []
                    articles_by_source[source].append(article)
            except Exception as e:
                err_str = str(e).lower()
                if 'timeout' in err_str or 'timed out' in err_str:
                    timeout_feeds.append(url)
                else:
                    failed_feeds.append((url, str(e)))

    rss_elapsed = time.time() - rss_start
    print(f"  - RSS 抓取耗时: {rss_elapsed:.1f}s")
    print(f"  - 成功: {len(feed_urls) - len(failed_feeds) - len(timeout_feeds) - len(empty_feeds)}, 空: {len(empty_feeds)}, 超时: {len(timeout_feeds)}, 失败: {len(failed_feeds)}")
    if timeout_feeds:
        print(f"  - 超时源: {[u.split('/')[-1][:25] for u in timeout_feeds[:5]]}")
    if failed_feeds:
        print(f"  - 失败源: {[f[0].split('/')[-1][:25] for f in failed_feeds[:5]]}")

    # Limit articles per source and merge
    # 聚焦模式：智能硬件源不受限制；泛AI模式：所有源均受限制
    hardware_article_count = 0
    for source, articles in articles_by_source.items():
        # Sort by published time within source
        articles.sort(key=lambda x: x.get("published", ""), reverse=True)

        # 检查是否是智能硬件源（仅聚焦模式下生效）
        is_hardware = hardware_unlimited and any(hw_name in source for hw_name in hardware_sources if hw_name)

        if is_hardware:
            # 智能硬件源：全部保留（仅聚焦模式）
            all_articles.extend(articles)
            hardware_article_count += len(articles)
        else:
            # 其他源：限制数量
            all_articles.extend(articles[:max_per_source])

    # Sort all by published time (newest first)
    all_articles.sort(key=lambda x: x.get("published", ""), reverse=True)

    print(f"  - Sources with articles: {len(articles_by_source)}")
    if hardware_unlimited:
        print(f"  - Smart hardware articles (unlimited): {hardware_article_count}")
    # Show top sources by article count
    source_counts = [(src, len(arts)) for src, arts in articles_by_source.items()]
    source_counts.sort(key=lambda x: -x[1])
    print(f"  - Top sources: {source_counts[:10]}")

    return all_articles

def apply_filters(articles: list[dict], settings: dict = None) -> list[dict]:
    """Apply blacklist/whitelist filters from settings to articles."""
    if settings is None:
        settings = load_settings()
    filters = settings.get("filters", {})
    blacklist_kw = [kw.lower() for kw in filters.get("blacklist_keywords", [])]
    blacklist_src = [src.lower() for src in filters.get("blacklist_sources", [])]
    whitelist_kw = [kw.lower() for kw in filters.get("whitelist_keywords", [])]
    whitelist_src = [src.lower() for src in filters.get("whitelist_sources", [])]

    if not any([blacklist_kw, blacklist_src, whitelist_kw, whitelist_src]):
        return articles

    filtered = []
    for article in articles:
        title = (article.get("title", "") or "").lower()
        desc = (article.get("description", "") or "").lower()
        source = (article.get("source", "") or "").lower()
        text = title + " " + desc

        # Blacklist: skip if matches
        if any(kw in text for kw in blacklist_kw):
            continue
        if any(src in source for src in blacklist_src):
            continue

        filtered.append(article)

    # Whitelist: boost matching articles to the front
    if whitelist_kw or whitelist_src:
        boosted = []
        normal = []
        for article in filtered:
            title = (article.get("title", "") or "").lower()
            desc = (article.get("description", "") or "").lower()
            source = (article.get("source", "") or "").lower()
            text = title + " " + desc
            if any(kw in text for kw in whitelist_kw) or any(src in source for src in whitelist_src):
                boosted.append(article)
            else:
                normal.append(article)
        filtered = boosted + normal

    return filtered

def get_prompt_for_mode(mode: str, articles_text: str, max_items: int, category_names: str, category_json_example: str, icon_mapping: str, custom_prompt: str = None, paywalled_sources: str = "") -> str:
    """Generate the Claude prompt based on topic mode or custom prompt.

    If custom_prompt is provided, it will be used directly with variable substitution:
    - {articles_text} - The news articles text
    - {max_items} - Maximum number of news items
    - {category_names} - Category names joined by 、
    - {category_json_example} - Example JSON structure
    - {icon_mapping} - Icon mapping string
    - {paywalled_sources} - Comma-separated list of paywalled source names
    """

    if custom_prompt:
        # Use custom prompt with variable substitution
        try:
            return custom_prompt.format(
                articles_text=articles_text,
                max_items=max_items,
                category_names=category_names,
                category_json_example=category_json_example,
                icon_mapping=icon_mapping,
                paywalled_sources=paywalled_sources
            )
        except KeyError as e:
            print(f"  Warning: Custom prompt has invalid variable {e}, falling back to mode-based prompt")

    if mode == "focused":
        # 聚焦模式：3 个主题分类，智能硬件最高优先级
        return f"""以下是最近24小时内从多个来源抓取的新闻列表。请帮我筛选和整理。

**分类规则**（严格按以下 3 个分类组织新闻）：

1. **🥽 智能硬件**【最高优先级】
   - AR/VR/MR/XR 设备、智能眼镜（Meta Ray-Ban、Apple Vision Pro、XREAL、Rokid 等）
   - 智能穿戴设备（智能手表、智能戒指、耳机等）
   - 空间计算、头显设备、脑机接口
   - 机器人（人形机器人、服务机器人、工业机器人）
   - AI 硬件（AI PC、AI 手机、AI 芯片等）
   - ⚠️ 这是我最关注的领域，请优先筛选，尽可能多收录

2. **🤖 AI技术与产品**
   - 模型能力提升：推理能力、多模态、长上下文、Agent 能力等
   - 新产品形态：AI Agent、AI 编程工具、AI 创作工具、AI 应用
   - 新范式：端侧 AI、开源模型、AI 基础设施、训练/推理优化

3. **🏢 巨头动向与行业观察**
   - 大公司战略布局、重要人事变动、并购收购
   - 行业趋势分析、政策法规影响
   - 重大投融资事件

**筛选要求**：
- 严格按上述 3 个分类筛选，不相关的新闻直接排除
- 智能硬件相关新闻优先收录，即使看起来不那么重大也要保留
- 去重：相同事件只保留最权威来源
- 每个分类内按重要性排序

**来源权威性优先**（重要）：
权威来源列表：IEEE Spectrum, The Verge, TechCrunch, Wired, Ars Technica, Tom's Hardware, AnandTech, EE Times, The Robot Report, 9to5Mac, 9to5Google, Reuters, BBC, Bloomberg, CNBC, 机器之心, 36氪, 量子位
- 如果某条新闻来自小众来源（如 UploadVR, Road to VR, VRFocus, AR Post, MIXED, 6DOF Reviews, XR Today, 93913, VR陀螺, 青亭网, 87870 等），请检查新闻列表中是否有权威来源报道了**完全相同的事件**
- 只有当你**确定**两篇文章报道的是同一事件时，才使用权威来源的 URL
- ⚠️ 关键：如果使用了某个来源的 URL，摘要必须准确反映该 URL 文章的内容，不能出现摘要和链接内容不符的情况
- 如果不确定是否是同一事件，或者权威来源的报道角度明显不同，保留原来源

**付费墙处理**：
以下来源是付费墙媒体：{paywalled_sources}
- 如果某条重要新闻来自付费墙源，请在新闻列表中寻找覆盖相同事件的免费源
- 找到后，使用免费源的 URL，但可以综合两个来源的信息写摘要
- 如果找不到免费替代，可以保留付费源但在 source 字段标注「(付费墙)」

**输出要求**：
- 为每条新闻写一个简短的中文摘要（1-2句话）
- **重要**：为每条新闻添加一句 comment，必须是一个启发思考的问题（以？结尾），引导读者深入思考这条新闻的意义、影响或未来可能性
- 总共最多选 {max_items} 条新闻，但智能硬件分类不受此限制，有多少收多少

新闻列表：
{articles_text}

请以 JSON 格式返回，结构如下：
{{
  "categories": [
    {{
      "name": "智能硬件",
      "icon": "🥽",
      "news": [...]
    }},
    {{
      "name": "AI技术与产品",
      "icon": "🤖",
      "news": [...]
    }},
    {{
      "name": "巨头动向与行业观察",
      "icon": "🏢",
      "news": [...]
    }}
  ]
}}

每条 news 的结构：
{{
  "title": "新闻标题",
  "summary": "1-2句中文摘要",
  "comment": "一个启发思考的问题？",
  "source": "来源",
  "url": "链接"
}}

注意：
- 分类顺序必须是：智能硬件 → AI技术与产品 → 巨头动向与行业观察
- 只返回有新闻的分类
- 只返回合法的 JSON，不要其他文字
- 确保所有字符串中的双引号用单引号替换
- comment 必须是问句（以？结尾），例如：「这是否意味着 AR 眼镜将取代手机成为下一个计算平台？」"""

    else:
        # 泛 AI 模式（默认）
        return f"""以下是最近24小时内从多个来源抓取的新闻列表。请帮我：

1. **严格筛选**：只保留与 AI（人工智能）直接相关的新闻
   - 必须包含的：AI 模型发布/更新、AI 公司动态、AI 融资、AI 产品、AI 政策法规、AI 应用落地、大模型、机器学习、深度学习、AIGC、AGI、机器人、自动驾驶等
   - 必须排除的：与 AI 无关的普通科技新闻（如手机发布、游戏、电商促销、社交媒体八卦、纯硬件评测等）
   - 边界情况：如果一条新闻主要讲某科技公司但核心内容与 AI 无关，应排除
2. 去重：相同事件的多篇报道只保留一条（保留最权威来源）
3. 按重要性排序（全球影响 > 行业影响 > 区域影响）
4. 为每条新闻写一个简短的中文摘要（1-2句话）
5. **重要**：为每条新闻添加一句 comment，必须是一个启发思考的问题（以？结尾），引导读者深入思考这条新闻的意义、影响或未来可能性
6. 将新闻按以下类别分组：{category_names}
   - 每条新闻只归入一个最匹配的类别
   - 没有对应新闻的类别不要输出

**重要**：总共最多选 {max_items} 条最值得看的新闻（不是每个分类 {max_items} 条），在这些新闻中归类排列。
摘要和标题中不要使用双引号，用单引号或其他标点代替。

新闻列表：
{articles_text}

请以 JSON 格式返回，结构如下：
{{
  "categories": {category_json_example}
}}

注意：
- 只返回有新闻的类别
- icon 必须与类别对应（{icon_mapping}）
- 每条 news 必须包含 comment 字段（启发思考的问句，以？结尾）
- 只返回合法的 JSON，不要其他文字
- 确保所有字符串中的双引号用单引号替换"""


def summarize_news_with_claude(anthropic_key: str, articles: list[dict], max_items: int = 10, settings: dict = None) -> list[dict]:
    """Use Claude to summarize, categorize, and select top news."""

    if not articles:
        return []

    if settings is None:
        settings = load_settings()

    topic_mode = settings.get("topic_mode", "broad")  # "broad" or "focused"
    custom_prompt = settings.get("custom_prompt", "")  # User-defined custom prompt
    client = anthropic.Anthropic(api_key=anthropic_key)

    # 聚焦模式使用专门的 3 个分类
    if topic_mode == "focused" and not custom_prompt:
        categories = [
            {"name": "智能硬件", "icon": "🥽"},
            {"name": "AI技术与产品", "icon": "🤖"},
            {"name": "巨头动向与行业观察", "icon": "🏢"},
        ]
    else:
        categories = get_categories(settings)

    if custom_prompt:
        print(f"  - Using custom prompt ({len(custom_prompt)} chars)")
    else:
        print(f"  - Topic mode: {topic_mode}")

    # Prepare articles for Claude
    articles_text = ""
    for i, article in enumerate(articles[:120], 1):  # Limit to 120 articles for diversity
        articles_text += f"""
---
Article {i}:
Title: {article.get('title', '')}
Source: {article.get('source', '')}
Published: {article.get('published', '')}
Description: {article.get('description', '')}
URL: {article.get('url', '')}
"""

    category_names = "、".join(c["name"] for c in categories)
    category_json_example = json.dumps(
        [{"name": c["name"], "icon": c["icon"], "news": [{"title": "...", "summary": "...", "comment": "一个启发思考的问题？", "source": "...", "url": "..."}]} for c in categories[:2]],
        ensure_ascii=False, indent=4
    )

    icon_mapping = " ".join(f'{c["name"]}:{c["icon"]}' for c in categories)

    # 获取付费墙源名称
    rss_feeds = settings.get("rss_feeds", [])
    paywalled_sources = ", ".join(
        feed.get("name", "") for feed in rss_feeds
        if feed.get("paywalled", False) and feed.get("enabled", True)
    )
    if paywalled_sources:
        print(f"  - Paywalled sources: {paywalled_sources}")

    prompt = get_prompt_for_mode(topic_mode, articles_text, max_items, category_names, category_json_example, icon_mapping, custom_prompt, paywalled_sources)

    import time
    claude_start = time.time()
    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            messages=[{"role": "user", "content": prompt}]
        )
        claude_elapsed = time.time() - claude_start
        print(f"  - Claude API ({topic_mode}) 耗时: {claude_elapsed:.1f}s")

        response_text = response.content[0].text

        # Extract JSON from response
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}') + 1
        if start_idx != -1 and end_idx > start_idx:
            json_str = response_text[start_idx:end_idx]

            # Try parsing directly first
            try:
                result = json.loads(json_str)
                return result.get("categories", [])
            except json.JSONDecodeError as first_error:
                print(f"  - JSON parse error (attempting fix): {first_error}")
                # Debug: show the problematic area
                error_pos = first_error.pos if hasattr(first_error, 'pos') else 0
                start_show = max(0, error_pos - 100)
                end_show = min(len(json_str), error_pos + 100)
                print(f"  - Error context (pos {error_pos}): ...{json_str[start_show:end_show]}...")

            # Fix common JSON issues
            import re

            # Remove control characters
            json_str = re.sub(r'[\x00-\x1f\x7f]', ' ', json_str)

            # Fix unescaped quotes inside string values
            # Match: "key": "value with "quotes" inside"
            def fix_quotes_in_value(match):
                key = match.group(1)
                value = match.group(2)
                # Replace inner quotes with single quotes
                fixed_value = value.replace('"', "'")
                return f'"{key}": "{fixed_value}"'

            # Pattern for string fields
            json_str = re.sub(
                r'"(title|summary|comment|source|url|name|icon)"\s*:\s*"((?:[^"\\]|\\.)*)(?<!\\)"',
                fix_quotes_in_value,
                json_str
            )

            # Try again
            try:
                result = json.loads(json_str)
                return result.get("categories", [])
            except json.JSONDecodeError as second_error:
                print(f"  - JSON fix attempt 1 failed: {second_error}")

            # More aggressive fix: use ast.literal_eval style parsing
            # Replace problematic patterns
            json_str = re.sub(r',\s*}', '}', json_str)  # trailing comma before }
            json_str = re.sub(r',\s*]', ']', json_str)  # trailing comma before ]

            # Try with relaxed JSON parser
            try:
                # Try to extract just the categories array if full parse fails
                cat_match = re.search(r'"categories"\s*:\s*(\[[\s\S]*\])', json_str)
                if cat_match:
                    categories_str = cat_match.group(1)
                    # Clean up the categories string
                    categories_str = re.sub(r',\s*}', '}', categories_str)
                    categories_str = re.sub(r',\s*]', ']', categories_str)
                    result = json.loads(categories_str)
                    print(f"  - Recovered {len(result)} categories from partial JSON")
                    return result
            except Exception as third_error:
                print(f"  - JSON fix attempt 2 failed: {third_error}")

            # Last resort: try line by line reconstruction
            try:
                lines = json_str.split('\n')
                fixed_lines = []
                for line in lines:
                    m = re.match(r'^(\s*"(?:title|summary|comment|source|url|name|icon)":\s*")(.*)(",?\s*)$', line)
                    if m:
                        value = m.group(2).replace('"', "'")
                        line = m.group(1) + value + m.group(3)
                    fixed_lines.append(line)
                json_str = '\n'.join(fixed_lines)
                result = json.loads(json_str)
                return result.get("categories", [])
            except Exception as final_error:
                print(f"  - All JSON fix attempts failed: {final_error}")
    except Exception as e:
        print(f"  Error: Failed to summarize news: {e}")

    return []

def fetch_news(anthropic_key: str, topic: str = "AI/科技", max_items: int = 10, settings: dict = None, manual: bool = False, hardware_unlimited: bool = None, channel: dict = None) -> dict:
    """Fetch and process news.

    Args:
        anthropic_key: API key for Claude
        topic: News topic
        max_items: Maximum news items to return
        settings: Configuration dict
        manual: If True, use current time as window end (manual trigger)
        hardware_unlimited: Override for hardware source limiting. If None, auto-detect from topic_mode.
        channel: Optional channel dict for time window calculation.

    Returns dict with categories and _raw_articles (for multi-channel reuse).
    """

    if settings is None:
        settings = load_settings()

    tz_name = settings.get("timezone", "Asia/Shanghai")
    tz = ZoneInfo(tz_name)
    today = datetime.now(tz).strftime("%Y-%m-%d")
    start_time, end_time = get_time_window(settings, manual=manual, channel=channel)
    cutoff = get_cutoff_time(settings, manual=manual, channel=channel)

    print(f"  - Time window: {start_time} ~ {end_time}")

    # 聚焦模式下，智能硬件源不受数量限制
    if hardware_unlimited is None:
        topic_mode = settings.get("topic_mode", "broad")
        hardware_unlimited = (topic_mode == "focused")

    print("  - Fetching news from RSS feeds...")
    raw_articles = fetch_raw_news(cutoff=cutoff, settings=settings, hardware_unlimited=hardware_unlimited)
    print(f"  - Got {len(raw_articles)} raw articles")

    # Apply blacklist/whitelist filters
    raw_articles = apply_filters(raw_articles, settings)
    print(f"  - After filtering: {len(raw_articles)} articles")

    if not raw_articles:
        return {
            "date": today,
            "time_window": f"{start_time} ~ {end_time}",
            "categories": [],
            "_raw_articles": [],
            "error": "No articles fetched from RSS feeds"
        }

    print("  - Summarizing with Claude...")
    categories = summarize_news_with_claude(anthropic_key, raw_articles, max_items, settings)
    total = sum(len(c.get("news", [])) for c in categories)
    print(f"  - Selected {total} top news in {len(categories)} categories")

    return {
        "date": today,
        "time_window": f"{start_time} ~ {end_time}",
        "categories": categories,
        "_raw_articles": raw_articles,
    }

def save_draft(news_data: dict, settings: dict = None, channel_id: str = None) -> str:
    """Save news data as a draft JSON file.

    Args:
        news_data: The news data dict (categories, date, etc.)
        settings: Configuration dict
        channel_id: If set, saves as a channel-specific draft (YYYY-MM-DD_ch_<id>.json)

    Returns the draft file path.
    """
    if settings is None:
        settings = load_settings()

    date = news_data.get("date", datetime.now().strftime("%Y-%m-%d"))
    drafts_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "drafts")
    os.makedirs(drafts_dir, exist_ok=True)

    if channel_id:
        filename = f"{date}_ch_{channel_id}.json"
    else:
        filename = f"{date}.json"
    draft_path = os.path.join(drafts_dir, filename)

    # Filter out internal fields like _raw_articles
    clean_data = {k: v for k, v in news_data.items() if not k.startswith("_")}

    draft_data = {
        **clean_data,
        "status": news_data.get("status", "pending_review"),
        "created_at": datetime.now(ZoneInfo(settings.get("timezone", "Asia/Shanghai"))).isoformat(),
    }

    # Add channel metadata for channel drafts
    if channel_id:
        draft_data["channel_id"] = channel_id
        # Find channel config to store name and topic_mode
        all_channels = settings.get("channels", settings.get("webhook_channels", []))
        for ch in all_channels:
            if ch.get("id") == channel_id:
                draft_data["channel_name"] = ch.get("name", "")
                draft_data["topic_mode"] = ch.get("topic_mode", "broad")
                break

    with open(draft_path, "w", encoding="utf-8") as f:
        json.dump(draft_data, f, ensure_ascii=False, indent=2)

    print(f"  - Draft saved to {draft_path}")

    # 清理 30 天前的旧草稿
    cleanup_old_drafts(drafts_dir, days=30)

    return draft_path


def cleanup_old_drafts(drafts_dir: str, days: int = 30):
    """Delete draft files older than specified days.

    Handles both YYYY-MM-DD.json and YYYY-MM-DD_ch_<id>.json formats.
    """
    cutoff_date = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    deleted = []

    try:
        for filename in os.listdir(drafts_dir):
            if not filename.endswith('.json'):
                continue
            # Extract date from filename: YYYY-MM-DD.json or YYYY-MM-DD_ch_xxx.json
            base = filename.replace('.json', '')
            # Date is always the first 10 chars (YYYY-MM-DD)
            file_date = base[:10]
            if len(file_date) == 10 and file_date < cutoff_date:
                filepath = os.path.join(drafts_dir, filename)
                os.remove(filepath)
                deleted.append(filename)
    except Exception as e:
        print(f"  Warning: Failed to cleanup old drafts: {e}")

    if deleted:
        print(f"  - Cleaned up {len(deleted)} old drafts: {deleted}")

def load_draft(date: str = None, channel_id: str = None):
    """Load a draft by date and optional channel_id.

    Args:
        date: Date string (YYYY-MM-DD). Defaults to today.
        channel_id: If set, loads the channel-specific draft.

    Returns the draft data dict, or None if not found.
    """
    if date is None:
        settings = load_settings()
        tz = ZoneInfo(settings.get("timezone", "Asia/Shanghai"))
        date = datetime.now(tz).strftime("%Y-%m-%d")

    drafts_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "drafts")

    if channel_id:
        filename = f"{date}_ch_{channel_id}.json"
    else:
        filename = f"{date}.json"
    draft_path = os.path.join(drafts_dir, filename)

    try:
        with open(draft_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None

def format_email_html(news_data: dict, settings: dict = None) -> str:
    """Format news data into a beautiful HTML email.

    Categories are rendered in the order from the draft (聚焦模式的顺序由 Claude 返回).
    """
    if settings is None:
        settings = load_settings()

    date = news_data.get("date", "")
    time_window = news_data.get("time_window", "")
    raw_categories = news_data.get("categories", [])

    # Build category sections - 直接按草稿中的顺序显示
    sections_html = ""
    has_news = False
    for cat in raw_categories:
        cat_name = cat.get("name", "")
        news_items = cat.get("news", [])
        if not news_items:
            continue
        has_news = True
        icon = CATEGORY_ICONS.get(cat_name, cat.get("icon", "📰"))

        cards_html = ""
        for item in news_items:
            title = item.get("title", "")
            summary = item.get("summary", "")
            comment = item.get("comment", "")
            source = item.get("source", "")
            url = item.get("url", "#")

            comment_html = ""
            if comment:
                comment_html = f'<p style="color:#7c3aed;font-size:13px;line-height:1.5;margin:8px 0 10px 0;padding:8px 12px;background:#f5f3ff;border-radius:6px;">🤔 {comment}</p>'

            cards_html += f'''<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
<tr><td style="background:#ffffff;border-radius:8px;border:1px solid #e8e8e8;padding:16px 20px;">
  <a href="{url}" style="color:#1a1a2e;text-decoration:none;font-size:15px;font-weight:600;line-height:1.4;display:block;" target="_blank">{title}</a>
  <p style="color:#555;font-size:14px;line-height:1.6;margin:8px 0 10px 0;">{summary}</p>
  {comment_html}
  <span style="display:inline-block;background:#eef2ff;color:#4f46e5;font-size:12px;padding:2px 10px;border-radius:12px;">{source}</span>
</td></tr>
</table>'''

        sections_html += f'''<tr><td style="padding:24px 30px 8px 30px;">
  <h2 style="margin:0 0 16px 0;font-size:18px;color:#1a1a2e;font-weight:700;">{icon} {cat_name}</h2>
  {cards_html}
</td></tr>'''

    if not has_news:
        sections_html = '<tr><td style="padding:20px 30px;color:#666;font-size:16px;">今日暂无重要新闻。</td></tr>'

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
