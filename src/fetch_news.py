#!/usr/bin/env python3
"""
Fetch AI/Tech news using RSS feeds and summarize with Claude.
"""

try:
    import anthropic
except ImportError:
    anthropic = None
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
            send_hour = settings.get("send_hour", 10)
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
        send_hour = channel.get("send_hour", 10)
        send_minute = channel.get("send_minute", 0)
    else:
        # Fallback: use the first channel's time, or defaults
        channels = settings.get("channels", [])
        first = channels[0] if channels else {}
        send_hour = first.get("send_hour", settings.get("send_hour", 10))
        send_minute = first.get("send_minute", settings.get("send_minute", 0))

    tz_name = settings.get("timezone", "Asia/Shanghai")
    tz = ZoneInfo(tz_name)

    now = datetime.now(tz)

    if manual:
        # Manual trigger: window ends at current time
        end_time = now
    else:
        # Auto trigger: window ends at today's scheduled send time
        # Fetch always happens shortly before send_time, so use today's send_time
        end_time = now.replace(hour=send_hour, minute=send_minute, second=0, microsecond=0)

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
        send_hour = channel.get("send_hour", 10)
        send_minute = channel.get("send_minute", 0)
    else:
        channels = settings.get("channels", [])
        first = channels[0] if channels else {}
        send_hour = first.get("send_hour", settings.get("send_hour", 10))
        send_minute = first.get("send_minute", settings.get("send_minute", 0))

    now = datetime.now(tz)

    if manual:
        # Manual trigger: 24h before now
        # Convert to UTC before stripping tzinfo (RSS published_parsed is naive UTC)
        cutoff = now - timedelta(days=1)
        return cutoff.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)
    else:
        # Auto trigger: 24h before today's scheduled send time
        today_send = now.replace(hour=send_hour, minute=send_minute, second=0, microsecond=0)
        cutoff = today_send - timedelta(days=1)
        return cutoff.astimezone(ZoneInfo("UTC")).replace(tzinfo=None)

def parse_feed(feed_url: str, cutoff: datetime = None) -> list[dict]:
    """Parse a single RSS feed and return recent articles."""
    articles = []
    if cutoff is None:
        cutoff = datetime.now() - timedelta(hours=24)

    try:
        # Use requests to fetch content first (handles SSL better than feedparser's urllib)
        try:
            resp = requests.get(feed_url, timeout=10, headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            feed = feedparser.parse(resp.content)
        except requests.RequestException:
            # Don't fallback to feedparser.parse(url) — it has no timeout and can hang
            return []
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
                "feed_url": feed_url,
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

    # Build feed_url → group mapping and per-group article limits
    rss_feeds = settings.get("rss_feeds", [])
    source_limits = settings.get("source_limits", {})
    default_limit = source_limits.get("default", max_per_source)
    feed_url_to_group = {}
    for feed in rss_feeds:
        if feed.get("enabled", True):
            feed_url_to_group[feed.get("url", "")] = feed.get("group", "")

    # 获取智能硬件源的 URL 列表（仅聚焦模式下不受限制）
    hardware_urls = set()
    if hardware_unlimited:
        for feed in rss_feeds:
            if feed.get("group") == "智能硬件" and feed.get("enabled", True):
                hardware_urls.add(feed.get("url", ""))
        print(f"  - Smart hardware sources (no limit): {len(hardware_urls)} feeds")

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

        # 检查是否是智能硬件源（通过 feed_url 精确匹配）
        is_hardware = hardware_unlimited and any(
            a.get("feed_url", "") in hardware_urls for a in articles
        ) if hardware_urls else False

        if is_hardware:
            # 智能硬件源：全部保留（仅聚焦模式）
            all_articles.extend(articles)
            hardware_article_count += len(articles)
        else:
            # 其他源：按组限制数量
            feed_url = articles[0].get("feed_url", "") if articles else ""
            group = feed_url_to_group.get(feed_url, "")
            limit = source_limits.get(group, default_limit)
            all_articles.extend(articles[:limit])

    # Sort all by published time (newest first)
    all_articles.sort(key=lambda x: x.get("published", ""), reverse=True)

    # Deduplicate by URL (keep first = newest due to sort above)
    seen_urls = set()
    deduped = []
    for article in all_articles:
        url = article.get("url", "")
        if url and url in seen_urls:
            continue
        if url:
            seen_urls.add(url)
        deduped.append(article)
    if len(deduped) < len(all_articles):
        print(f"  - RSS dedup: removed {len(all_articles) - len(deduped)} duplicate URLs")
    all_articles = deduped

    print(f"  - Sources with articles: {len(articles_by_source)}")
    if hardware_unlimited:
        print(f"  - Smart hardware articles (unlimited): {hardware_article_count}")
    # Show top sources by article count
    source_counts = [(src, len(arts)) for src, arts in articles_by_source.items()]
    source_counts.sort(key=lambda x: -x[1])
    print(f"  - Top sources: {source_counts[:10]}")

    # Cluster by title similarity and annotate coverage
    all_articles = _cluster_and_annotate(all_articles)

    return all_articles


def _title_tokens(title: str) -> set:
    """Normalize title into a set of tokens for similarity comparison."""
    import re
    # Remove punctuation, lowercase, split
    title = re.sub(r'[^\w\s]', ' ', title.lower())
    # Remove very short tokens (articles, prepositions)
    return {t for t in title.split() if len(t) > 1}


def _title_similarity(tokens_a: set, tokens_b: set) -> float:
    """Jaccard similarity between two token sets."""
    if not tokens_a or not tokens_b:
        return 0.0
    return len(tokens_a & tokens_b) / len(tokens_a | tokens_b)


def _cluster_and_annotate(articles: list[dict]) -> list[dict]:
    """Cluster articles by title similarity, annotate each with coverage info.

    Articles covering the same event (from different sources) get:
    - coverage_count: number of sources reporting this event
    - coverage_sources: list of source names
    - is_primary: True if this is the representative article for the cluster
    """
    if not articles:
        return articles

    # Build token sets for all titles
    title_tokens = []
    for a in articles:
        title_tokens.append(_title_tokens(a.get("title", "")))

    # Greedy clustering: assign each article to existing cluster or create new one
    clusters = []  # list of lists of article indices
    cluster_tokens = []  # representative tokens for each cluster
    SIMILARITY_THRESHOLD = 0.35

    for i, tokens in enumerate(title_tokens):
        best_cluster = -1
        best_sim = 0.0
        for ci, ct in enumerate(cluster_tokens):
            sim = _title_similarity(tokens, ct)
            if sim > best_sim:
                best_sim = sim
                best_cluster = ci
        if best_sim >= SIMILARITY_THRESHOLD:
            clusters[best_cluster].append(i)
            # Expand cluster tokens with new article's tokens
            cluster_tokens[best_cluster] = cluster_tokens[best_cluster] | tokens
        else:
            clusters.append([i])
            cluster_tokens.append(tokens)

    # Annotate articles
    for cluster in clusters:
        sources = []
        for idx in cluster:
            src = articles[idx].get("source", "unknown")
            if src not in sources:
                sources.append(src)
        count = len(sources)
        for j, idx in enumerate(cluster):
            articles[idx]["coverage_count"] = count
            articles[idx]["coverage_sources"] = sources
            articles[idx]["is_primary"] = (j == 0)  # first in cluster is primary

    # Sort: higher coverage first, then by published time
    articles.sort(key=lambda x: (-x.get("coverage_count", 1), x.get("published", "")), reverse=False)

    multi = sum(1 for c in clusters if len(c) > 1)
    if multi:
        print(f"  - Event clustering: {len(clusters)} events from {len(articles)} articles, {multi} multi-source events")

    return articles


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

def get_prompt_for_mode(mode: str, articles_text: str, max_items: int, category_names: str, category_json_example: str, icon_mapping: str, custom_prompt: str = None, paywalled_sources: str = "", previously_reported: str = "") -> str:
    """Generate the Claude prompt based on topic mode or custom prompt.

    If custom_prompt is provided, it will be used directly with variable substitution:
    - {articles_text} - The news articles text
    - {max_items} - Maximum number of news items
    - {category_names} - Category names joined by 、
    - {category_json_example} - Example JSON structure
    - {icon_mapping} - Icon mapping string
    - {paywalled_sources} - Comma-separated list of paywalled source names
    - {previously_reported} - Previously reported news titles for cross-day dedup
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
                paywalled_sources=paywalled_sources,
                previously_reported=previously_reported
            )
        except KeyError as e:
            print(f"  Warning: Custom prompt has invalid variable {e}, falling back to mode-based prompt")

    if mode == "focused":
        # 聚焦模式：拆成两个独立 prompt，分别调用后合并
        # 返回 None，由 summarize_news_with_claude 处理拆分调用
        return None

    if mode == "focused_hardware":
        return f"""以下是最近24小时内从多个来源抓取的新闻列表。请从中筛选出与**AI智能硬件设备**相关的新闻。

**属于智能硬件的范围**（面向消费者或行业的AI设备）：
- AR/VR/MR/XR 头显、智能眼镜（Meta Ray-Ban、Apple Vision Pro、XREAL、Rokid 等）
- AI 穿戴设备（AI 手表、AI 戒指、AI 耳机等）
- 机器人（人形机器人、服务机器人、工业机器人）
- AI 终端设备（AI 手机、AI PC 等具体设备产品）

**不属于智能硬件**（必须排除，这些应放在别的类别）：
- AI 芯片、AI 基础设施、数据中心投资（→ 属于AI技术/行业）
- 卫星、航天器、太空设备（→ 属于行业观察）
- 传统电脑、游戏主机（PlayStation、Xbox、Switch）
- 普通消费电子（电视、音箱、相机等）
- 纯软件产品、互联网服务

**数量要求**：选 7-10 条，不多不少。

**筛选要求**：
- ★ 标记的文章表示被多个来源报道，这些是热点事件，应优先选入
- 去重：相同事件只保留最权威来源
- 按重要性排序（多源覆盖 > 权威来源独家 > 单源报道）

**来源权威性优先**：
- 如果某条新闻来自小众来源（如 UploadVR, 93913, VR陀螺 等），检查是否有权威来源（The Verge, TechCrunch, Wired 等）报道了完全相同的事件
- 只有确定是同一事件时，才替换为权威来源 URL
- ⚠️ 使用某个来源的 URL 时，摘要必须准确反映该 URL 文章的内容

**付费墙处理**：
付费墙媒体：{paywalled_sources}
- 如有免费替代源报道相同事件，使用免费源 URL

**输出要求**：
- 为每条新闻写一个简短的中文摘要（1-2句话）
- 为每条新闻添加一句 comment，必须是一个启发思考的问题（以？结尾）
{previously_reported}
新闻列表：
{articles_text}

请以 JSON 格式返回，结构如下：
{{
  "news": [
    {{
      "title": "中文标题",
      "summary": "1-2句中文摘要",
      "comment": "一个启发思考的问题？",
      "source": "来源",
      "url": "链接"
    }}
  ]
}}

注意：
- 标题必须翻译为中文，英文标题一律翻译
- 只返回合法的 JSON，不要其他文字
- 确保所有字符串中的双引号用单引号替换"""

    if mode == "focused_ai_industry":
        return f"""以下是最近24小时内从多个来源抓取的新闻列表。请从中筛选出与以下两个分类相关的新闻。

**分类 1：🤖 AI技术与产品**
- 模型能力提升：推理能力、多模态、长上下文、Agent 能力等
- 新产品形态：AI Agent、AI 编程工具、AI 创作工具、AI 应用
- 新范式：端侧 AI、开源模型、AI 基础设施、训练/推理优化

**分类 2：🏢 巨头动向与行业观察**
- 科技巨头的**AI相关**战略布局、并购收购
  - 国内大厂（字节跳动/豆包、阿里/通义千问、腾讯、百度/文心、华为、小米、美团、京东等）的 AI 动态要重点关注
  - 海外巨头（OpenAI、Google、Meta、Microsoft、Apple、Amazon 等）
- AI 行业趋势、AI 政策法规
- AI 领域重大投融资事件（包括AI芯片、AI基础设施投资）
- AI 相关重要人事变动

⚠️ **中外新闻平衡**：如有国内大厂相关的 AI 新闻，至少选入 1 条。不要全是海外新闻。

⚠️ **所有新闻必须与AI/人工智能直接相关**。以下不收录：
- 与AI无关的科技新闻（传统媒体人事、非AI公司裁员、加密货币等）
- 纯商业/金融新闻（除非直接涉及AI投资）

**筛选要求**：
- ★ 标记的文章表示被多个来源报道，这些是热点事件，应优先选入
- 排除所有智能硬件设备新闻（AR/VR头显、智能眼镜、机器人等具体设备）
- AI技术与产品：至少选 2 条
- 巨头动向与行业观察：至少选 1 条
- 两个分类合计最多 {max_items} 条
- 去重：相同事件只保留最权威来源
- 按重要性排序（多源覆盖 > 权威来源独家 > 单源报道）

**来源权威性优先**：
- 中文权威来源：36氪、机器之心、量子位、虎嗅、钛媒体、晚点LatePost、Founder Park
- 英文权威来源：The Verge, TechCrunch, Reuters, Bloomberg, Wired
- ⚠️ 使用某个来源的 URL 时，摘要必须准确反映该 URL 文章的内容

**付费墙处理**：
付费墙媒体：{paywalled_sources}
- 如有免费替代源报道相同事件，使用免费源 URL

**输出要求**：
- 为每条新闻写一个简短的中文摘要（1-2句话）
- 为每条新闻添加一句 comment，必须是一个启发思考的问题（以？结尾）
{previously_reported}
新闻列表：
{articles_text}

请以 JSON 格式返回，结构如下：
{{
  "categories": [
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
  "title": "中文标题",
  "summary": "1-2句中文摘要",
  "comment": "一个启发思考的问题？",
  "source": "来源",
  "url": "链接"
}}

注意：
- 两个分类都必须有内容
- 标题必须翻译为中文，英文标题一律翻译
- 只返回合法的 JSON，不要其他文字
- 确保所有字符串中的双引号用单引号替换"""

    else:
        # 泛 AI 模式（默认）
        return f"""以下是最近24小时内从多个来源抓取的新闻列表。请帮我：

1. **严格筛选**：只保留与 AI（人工智能）直接相关的新闻
   - 必须包含的：AI 模型发布/更新、AI 公司动态、AI 融资、AI 产品、AI 政策法规、AI 应用落地、大模型、机器学习、深度学习、AIGC、AGI、机器人、自动驾驶等
   - 必须排除的：与 AI 无关的普通科技新闻（如手机发布、游戏、电商促销、社交媒体八卦、纯硬件评测等）
   - 边界情况：如果一条新闻主要讲某科技公司但核心内容与 AI 无关，应排除
2. **优先热点**：标有 ★ 的文章表示被多个来源报道，是热点事件，应优先选入
3. 去重：相同事件的多篇报道只保留一条（保留最权威来源）
4. **中外平衡**：如有国内大厂（字节跳动/豆包、阿里/通义千问、腾讯、百度/文心、华为、小米等）的 AI 相关新闻，至少选入 1 条，不要全是海外新闻
5. 按重要性排序（多源覆盖 > 全球影响 > 行业影响 > 区域影响）
6. 为每条新闻写一个简短的中文摘要（1-2句话）
7. **重要**：为每条新闻添加一句 comment，必须是一个启发思考的问题（以？结尾），引导读者深入思考这条新闻的意义、影响或未来可能性
8. 将新闻按以下类别分组：{category_names}
   - 每条新闻只归入一个最匹配的类别
   - 没有对应新闻的类别不要输出

**重要**：总共最多选 {max_items} 条最值得看的新闻（不是每个分类 {max_items} 条），在这些新闻中归类排列。
摘要和标题中不要使用双引号，用单引号或其他标点代替。
{previously_reported}
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


def _call_deepseek(prompt: str, label: str) -> str:
    """Call DeepSeek V3 API and return response text. Returns None on failure."""
    import time
    import re
    from openai import OpenAI as OpenAIClient

    api_key = os.environ.get("DEEPSEEK_API_KEY")
    if not api_key:
        return None

    client = OpenAIClient(api_key=api_key, base_url="https://api.deepseek.com")
    start = time.time()
    try:
        resp = client.chat.completions.create(
            model="deepseek-chat",
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
        elapsed = time.time() - start
        print(f"  - DeepSeek ({label}) 耗时: {elapsed:.1f}s")
        text = resp.choices[0].message.content
        # Strip <think> tags if present
        text = re.sub(r'<think>[\s\S]*?</think>', '', text).strip()
        return text
    except Exception as e:
        print(f"  - DeepSeek ({label}) error: {e}")
        return None


def _parse_json_response(response_text: str):
    """Extract and parse JSON from model response text. Returns parsed dict or None.

    Uses multi-pass JSON repair matching the main summarize function.
    """
    import re
    start_idx = response_text.find('{')
    end_idx = response_text.rfind('}') + 1
    if start_idx == -1 or end_idx <= start_idx:
        return None
    json_str = response_text[start_idx:end_idx]

    # Pass 1: direct parse
    try:
        return json.loads(json_str)
    except json.JSONDecodeError as first_error:
        print(f"  - JSON parse error (attempting fix): {first_error}")

    # Pass 2: control chars + unescaped quotes fix
    json_str = re.sub(r'[\x00-\x1f\x7f]', ' ', json_str)

    def fix_quotes_in_value(match):
        key = match.group(1)
        value = match.group(2)
        fixed_value = value.replace('"', "'")
        return f'"{key}": "{fixed_value}"'

    json_str = re.sub(
        r'"(title|summary|comment|source|url|name|icon)"\s*:\s*"((?:[^"\\]|\\.)*)(?<!\\)"',
        fix_quotes_in_value,
        json_str
    )

    try:
        return json.loads(json_str)
    except json.JSONDecodeError as second_error:
        print(f"  - JSON fix attempt 1 failed: {second_error}")

    # Pass 3: trailing commas + extract categories array
    json_str = re.sub(r',\s*}', '}', json_str)
    json_str = re.sub(r',\s*]', ']', json_str)

    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        pass

    try:
        cat_match = re.search(r'"categories"\s*:\s*(\[[\s\S]*\])', json_str)
        if cat_match:
            categories_str = cat_match.group(1)
            categories_str = re.sub(r',\s*}', '}', categories_str)
            categories_str = re.sub(r',\s*]', ']', categories_str)
            result = json.loads(categories_str)
            print(f"  - Recovered {len(result)} categories from partial JSON")
            return {"categories": result}
    except Exception:
        pass

    # Pass 4: line-by-line quote reconstruction
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
        return json.loads(json_str)
    except Exception as final_error:
        print(f"  - All JSON fix attempts failed: {final_error}")
        return None


def _call_haiku(client, prompt: str, label: str) -> str:
    """Call Claude Haiku and return response text. Returns None on failure."""
    import time
    try:
        start = time.time()
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=8192,
            messages=[{"role": "user", "content": prompt}],
        )
        elapsed = time.time() - start
        print(f"  - Haiku ({label}) {elapsed:.1f}s, stop_reason: {resp.stop_reason}")
        if resp.stop_reason == "max_tokens":
            print(f"  - WARNING: Response was truncated (hit max_tokens)")
        return resp.content[0].text
    except Exception as e:
        print(f"  - Haiku ({label}) error: {e}")
        return None


def _call_ai(prompt: str, label: str, anthropic_client=None) -> str:
    """Call the best available AI backend. Tries DeepSeek first, falls back to Haiku.

    Returns response text, or None if all backends fail.
    """
    if os.environ.get("DEEPSEEK_API_KEY"):
        result = _call_deepseek(prompt, label)
        if result:
            return result
        print(f"  - DeepSeek failed for {label}, trying Haiku fallback...")
    if anthropic_client:
        return _call_haiku(anthropic_client, prompt, label)
    print(f"  - No AI backend available for {label}")
    return None


def _load_recent_titles(settings: dict, days: int = 2) -> list[str]:
    """Load news titles from recent drafts for cross-day dedup.

    Scans the last N days' draft files (excluding today) and extracts
    all news titles that were already sent or are pending.
    """
    drafts_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "config", "drafts")
    if not os.path.exists(drafts_dir):
        return []

    tz_name = settings.get("timezone", "Asia/Shanghai")
    tz = ZoneInfo(tz_name)

    titles = set()
    try:
        all_files = os.listdir(drafts_dir)
    except OSError:
        return []

    for d in range(1, days + 1):
        date_str = (datetime.now(tz) - timedelta(days=d)).strftime("%Y-%m-%d")
        for filename in all_files:
            if filename.startswith(date_str) and filename.endswith(".json"):
                try:
                    filepath = os.path.join(drafts_dir, filename)
                    with open(filepath, "r", encoding="utf-8") as f:
                        draft = json.load(f)
                    for cat in draft.get("categories", []):
                        for news in cat.get("news", []):
                            title = news.get("title", "").strip()
                            if title:
                                titles.add(title)
                except (json.JSONDecodeError, IOError):
                    pass

    return sorted(titles)


def _format_previously_reported(titles: list[str]) -> str:
    """Format previously reported titles for injection into AI prompts."""
    if not titles:
        return ""
    titles_list = "\n".join(f"- {t}" for t in titles[:40])
    return f"""

⚠️ **跨天去重**：以下是昨天已推送过的新闻标题，请避免选择完全相同的旧闻。
但注意：**优先保证选够数量**，去重只排除明确重复的旧闻。如果排除后数量不够，宁可保留有一定相关性的新闻也不要留空。
有实质新信息的后续报道可以选入（如昨天报了发布，今天出了测评结果）。

已报道过的新闻：
{titles_list}
"""


def _format_articles_text(articles: list[dict]) -> str:
    """Format a list of article dicts into text for Claude prompts."""
    text = ""
    for i, article in enumerate(articles, 1):
        coverage = article.get('coverage_count', 1)
        coverage_line = ""
        if coverage > 1:
            sources = ", ".join(article.get('coverage_sources', []))
            coverage_line = f"\nCoverage: {coverage} sources ({sources}) ★"
        text += f"""
---
Article {i}:
Title: {article.get('title', '')}
Source: {article.get('source', '')}{coverage_line}
Published: {article.get('published', '')}
Description: {article.get('description', '')}
URL: {article.get('url', '')}
"""
    return text


def _focused_split_call(client, articles: list[dict], max_items: int, paywalled_sources: str, settings: dict, previously_reported: str = "") -> list[dict]:
    """Focused mode: two sequential AI calls for hardware and AI/industry, then merge."""
    import time

    print(f"  - Focused mode: 2 AI calls (hardware + AI/industry)")

    # Split articles: hardware sources vs others
    hw_urls = set()
    for feed in settings.get("rss_feeds", []):
        if feed.get("group") == "智能硬件" and feed.get("enabled", True):
            hw_urls.add(feed.get("url", ""))

    hw_articles = [a for a in articles if a.get("feed_url", "") in hw_urls]
    other_articles = [a for a in articles if a.get("feed_url", "") not in hw_urls]
    print(f"  - Article split: {len(hw_articles)} hardware, {len(other_articles)} other")

    other_articles_text = _format_articles_text(other_articles) if other_articles else _format_articles_text(articles)

    if hw_articles:
        hw_articles_text = _format_articles_text(hw_articles)
        hw_budget = 10  # hardware gets 7-10 items
        ai_budget = max(max_items - hw_budget, 5)  # rest goes to AI+industry, at least 5
        prompt_hw = get_prompt_for_mode("focused_hardware", hw_articles_text, max_items, "", "", "", None, paywalled_sources, previously_reported)
        print(f"  - Budget: hardware 7-10, AI+industry {ai_budget}, total cap {max_items}")
    else:
        # No hardware sources produced articles -- skip hardware prompt, give all budget to AI/industry
        print("  - No hardware articles found, skipping hardware prompt")
        hw_budget = 0
        ai_budget = max_items
        prompt_hw = None

    prompt_ai = get_prompt_for_mode("focused_ai_industry", other_articles_text, ai_budget, "", "", "", None, paywalled_sources, previously_reported)

    start = time.time()

    def _call_and_parse(prompt, label, max_retries=2):
        """Call AI and parse JSON, with retries for both API and parse failures."""
        for attempt in range(max_retries + 1):
            if attempt > 0:
                print(f"  - Retrying {label} (attempt {attempt + 1})...")
                time.sleep(3)
            resp = _call_ai(prompt, f"{label}" if attempt == 0 else f"{label}-retry{attempt}", anthropic_client=client)
            if not resp:
                print(f"  - {label}: API call returned None")
                continue
            parsed = _parse_json_response(resp)
            if parsed:
                return parsed
            print(f"  - {label}: JSON parse failed. Preview: {resp[:200]}")
        return None

    hw_parsed = _call_and_parse(prompt_hw, "智能硬件") if prompt_hw else None
    ai_parsed = _call_and_parse(prompt_ai, "AI+行业")

    elapsed = time.time() - start
    print(f"  - Focused split total 耗时: {elapsed:.1f}s")

    categories = []

    # Parse hardware result
    if hw_parsed:
        hw_news = hw_parsed.get("news", [])
        if hw_news:
            categories.append({"name": "智能硬件", "icon": "🥽", "news": hw_news})
            print(f"  - 🥽 智能硬件: {len(hw_news)} 条")
        else:
            print(f"  - 🥽 智能硬件: parsed OK but no 'news' key. Keys: {list(hw_parsed.keys())}")
    else:
        print(f"  - 🥽 智能硬件: all attempts failed")

    # Collect URLs from hardware for dedup
    seen_urls = set()
    for cat in categories:
        for news in cat.get("news", []):
            url = news.get("url", "")
            if url:
                seen_urls.add(url)

    if ai_parsed:
        ai_cats = ai_parsed.get("categories", [])
        print(f"  - AI+行业: parsed OK, {len(ai_cats)} categories. Keys: {list(ai_parsed.keys())}")
        for cat in ai_cats:
            cat_name = cat.get("name", "?")
            cat_news = cat.get("news", [])
            deduped_news = [n for n in cat_news if n.get("url", "") not in seen_urls]
            removed = len(cat_news) - len(deduped_news)
            if deduped_news:
                categories.append({"name": cat_name, "icon": cat.get("icon", ""), "news": deduped_news})
                msg = f"  - {cat.get('icon', '')} {cat_name}: {len(deduped_news)} 条"
                if removed > 0:
                    msg += f" (去重移除 {removed} 条)"
                print(msg)
            else:
                print(f"  - {cat.get('icon', '')} {cat_name}: 0 条 (all {len(cat_news)} deduped)")
    else:
        print(f"  - AI+行业: all attempts failed")

    total = sum(len(c.get("news", [])) for c in categories)
    print(f"  - Focused total: {total} items in {len(categories)} categories")

    if not categories:
        print(f"  - WARNING: Both calls failed, returning empty")

    return categories


def summarize_news_with_claude(anthropic_key: str, articles: list[dict], max_items: int = 10, settings: dict = None) -> list[dict]:
    """Use AI to summarize, categorize, and select top news.

    Tries DeepSeek first, falls back to Claude Haiku if DeepSeek is unavailable.
    """

    if not articles:
        return []

    if settings is None:
        settings = load_settings()

    topic_mode = settings.get("topic_mode", "broad")  # "broad" or "focused"
    custom_prompt = settings.get("custom_prompt", "")  # User-defined custom prompt
    client = anthropic.Anthropic(api_key=anthropic_key) if (anthropic_key and anthropic) else None

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
        coverage = article.get('coverage_count', 1)
        coverage_line = ""
        if coverage > 1:
            sources = ", ".join(article.get('coverage_sources', []))
            coverage_line = f"\nCoverage: {coverage} sources ({sources}) ★"
        articles_text += f"""
---
Article {i}:
Title: {article.get('title', '')}
Source: {article.get('source', '')}
Published: {article.get('published', '')}{coverage_line}
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

    # Load recently reported titles for cross-day dedup
    recent_titles = _load_recent_titles(settings)
    previously_reported = _format_previously_reported(recent_titles)
    if recent_titles:
        print(f"  - Cross-day dedup: {len(recent_titles)} titles from recent drafts")

    prompt = get_prompt_for_mode(topic_mode, articles_text, max_items, category_names, category_json_example, icon_mapping, custom_prompt, paywalled_sources, previously_reported)

    import time
    claude_start = time.time()

    # Focused mode: split into 2 parallel calls (hardware + AI/industry)
    if prompt is None and topic_mode == "focused":
        return _focused_split_call(client, articles[:120], max_items, paywalled_sources, settings, previously_reported)

    # Retry logic (matches focused mode's _call_and_parse behavior)
    max_retries = 2
    for attempt in range(max_retries + 1):
        if attempt > 0:
            print(f"  - Retrying {topic_mode} mode (attempt {attempt + 1})...")
            time.sleep(3)

        response_text = _call_ai(prompt, topic_mode, anthropic_client=client)
        if not response_text:
            print(f"  - {topic_mode}: AI call returned None (attempt {attempt + 1})")
            continue

        claude_elapsed = time.time() - claude_start
        print(f"  - AI ({topic_mode}) 耗时: {claude_elapsed:.1f}s")

        parsed = _parse_json_response(response_text)
        if parsed:
            categories_result = parsed.get("categories", [])
            if categories_result:
                return categories_result
            print(f"  - {topic_mode}: parsed OK but 0 categories (attempt {attempt + 1})")
            continue

        print(f"  - {topic_mode}: JSON parse failed (attempt {attempt + 1}). Preview: {response_text[:200]}")

    print(f"  Error: All {max_retries + 1} attempts failed for {topic_mode} mode")
    return []

def fetch_news(anthropic_key: str = "", topic: str = "AI/科技", max_items: int = 10, settings: dict = None, manual: bool = False, hardware_unlimited: bool = None, channel: dict = None) -> dict:
    """Fetch and process news.

    Args:
        anthropic_key: API key for Claude (optional if DEEPSEEK_API_KEY is set)
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

    backend = "DeepSeek" if os.environ.get("DEEPSEEK_API_KEY") else "Claude"
    print(f"  - Summarizing with {backend}...")
    categories = summarize_news_with_claude(anthropic_key, raw_articles, max_items, settings)

    # Post-AI dedup: remove duplicate URLs across categories
    seen_urls = set()
    dedup_removed = 0
    for cat in categories:
        original = cat.get("news", [])
        unique = []
        for news in original:
            url = news.get("url", "")
            if url and url in seen_urls:
                dedup_removed += 1
                continue
            if url:
                seen_urls.add(url)
            unique.append(news)
        cat["news"] = unique
    # Remove empty categories after dedup
    categories = [c for c in categories if c.get("news")]
    if dedup_removed:
        print(f"  - Post-AI dedup: removed {dedup_removed} duplicate URLs across categories")

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

    # Never overwrite a draft that's already been sent or rejected
    if os.path.exists(draft_path):
        try:
            with open(draft_path, "r", encoding="utf-8") as f:
                existing = json.load(f)
            existing_status = existing.get("status", "")
            if existing_status in ("sent", "rejected", "approved"):
                print(f"  - Skipping {filename}: already {existing_status}")
                return draft_path
        except (json.JSONDecodeError, IOError):
            pass  # Corrupted file, safe to overwrite

    # Filter out internal fields like _raw_articles
    clean_data = {k: v for k, v in news_data.items() if not k.startswith("_")}

    draft_data = {
        **clean_data,
        "status": news_data.get("status", "pending_review"),
        "source": news_data.get("source", "scheduled"),
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
<tr><td style="background-color:#1a1a2e;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:32px 30px;text-align:center;">
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
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    deepseek_key = os.environ.get("DEEPSEEK_API_KEY", "")

    if not anthropic_key and not deepseek_key:
        print("Error: Neither ANTHROPIC_API_KEY nor DEEPSEEK_API_KEY is set")
        exit(1)

    news_data = fetch_news(anthropic_key)
    print(json.dumps(news_data, ensure_ascii=False, indent=2))
