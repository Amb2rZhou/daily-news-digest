---
name: daily-news-digest
description: 每日新闻摘要自动化工作流模板。可配置不同领域（AI/科技、金融、医疗等），自动从 RSS 源获取新闻，用 Claude 整理摘要，通过邮件定时发送。当用户需要：(1) 创建新的新闻推送项目，(2) 配置不同领域的新闻源，(3) 设置 GitHub Actions 自动化，(4) 生成每日新闻报告时使用此 skill。
---

# 每日新闻摘要 (Daily News Digest)

可复用的新闻自动推送工作流模板。**支持任意领域**，只需替换 RSS 源和分类配置即可适配。部署到 GitHub Actions 实现全自动化。

## 架构概览

```
RSS Feeds → Claude AI 筛选/分类/摘要 → 各频道草稿 → 审核 → 邮件发送 / Webhook 群聊推送
    ↓                                      ↓
GitHub Actions (sleep-based)          Admin UI 人工审核
fetch-news.yml → send-ch-*.yml        (卡片式 Dashboard)
```

## 适配不同领域

本模板默认配置了 AI/科技领域，但可以轻松适配到任何领域。适配时需要修改以下三处：

### 1. 替换 RSS 源

在 `config/settings.json` 的 `rss_feeds` 数组中替换为目标领域的 RSS 源。

**示例 — 金融领域**：
```json
{
  "rss_feeds": [
    { "url": "https://feeds.reuters.com/reuters/businessNews", "name": "Reuters Business", "group": "国际财经", "enabled": true },
    { "url": "https://www.ft.com/rss/home", "name": "Financial Times", "group": "国际财经", "enabled": true },
    { "url": "https://finance.sina.com.cn/rss/finance.xml", "name": "新浪财经", "group": "中文财经", "enabled": true }
  ]
}
```

**示例 — 医疗健康领域**：
```json
{
  "rss_feeds": [
    { "url": "https://www.statnews.com/feed/", "name": "STAT News", "group": "医疗媒体", "enabled": true },
    { "url": "https://www.fiercebiotech.com/rss/xml", "name": "FierceBiotech", "group": "生物科技", "enabled": true }
  ]
}
```

### 各领域 RSS 源推荐

以下是各领域经过验证的 RSS 源，可直接复制到 `config/settings.json` 使用。

#### 金融财经

```json
{
  "rss_feeds": [
    { "url": "https://feeds.reuters.com/reuters/businessNews", "name": "Reuters Business", "group": "国际财经", "enabled": true },
    { "url": "https://www.ft.com/rss/home", "name": "Financial Times", "group": "国际财经", "enabled": true },
    { "url": "https://feeds.bloomberg.com/markets/news.rss", "name": "Bloomberg Markets", "group": "国际财经", "enabled": true },
    { "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html", "name": "CNBC", "group": "国际财经", "enabled": true },
    { "url": "https://feeds.marketwatch.com/marketwatch/topstories", "name": "MarketWatch", "group": "国际财经", "enabled": true },
    { "url": "https://feeds.content.dowjones.io/public/rss/mw_topstories", "name": "WSJ Markets", "group": "国际财经", "enabled": true },
    { "url": "https://www.forbes.com/money/feed/", "name": "Forbes Money", "group": "国际财经", "enabled": true },
    { "url": "https://www.investopedia.com/feedbuilder/feed/getfeed?feedName=rss_headline", "name": "Investopedia", "group": "投资教育", "enabled": true },
    { "url": "https://finance.sina.com.cn/rss/finance.xml", "name": "新浪财经", "group": "中文财经", "enabled": true },
    { "url": "https://rsshub.app/cls/telegraph", "name": "财联社电报", "group": "中文财经", "enabled": true },
    { "url": "https://rsshub.app/eastmoney/report/strategy", "name": "东方财富研报", "group": "中文财经", "enabled": true }
  ]
}
```

**建议分类**：宏观经济 📈、股市行情 📊、公司动态 🏢、金融监管 ⚖️、投资理财 💰

#### 医疗健康

```json
{
  "rss_feeds": [
    { "url": "https://www.statnews.com/feed/", "name": "STAT News", "group": "医疗媒体", "enabled": true },
    { "url": "https://www.fiercebiotech.com/rss/xml", "name": "FierceBiotech", "group": "生物科技", "enabled": true },
    { "url": "https://www.fiercepharma.com/rss/xml", "name": "FiercePharma", "group": "制药", "enabled": true },
    { "url": "https://www.healthcareitnews.com/feed", "name": "Healthcare IT News", "group": "医疗科技", "enabled": true },
    { "url": "https://www.medscape.com/cx/rssfeeds/2684.xml", "name": "Medscape", "group": "临床医学", "enabled": true },
    { "url": "https://feeds.nature.com/nm/rss/current", "name": "Nature Medicine", "group": "学术期刊", "enabled": true },
    { "url": "https://feeds.nejm.org/nejm/rss/atom.xml", "name": "NEJM", "group": "学术期刊", "enabled": true },
    { "url": "https://www.who.int/feeds/entity/mediacentre/news/en/rss.xml", "name": "WHO News", "group": "公共卫生", "enabled": true },
    { "url": "https://rsshub.app/dxy/bbs/recommend", "name": "丁香园", "group": "中文医疗", "enabled": true }
  ]
}
```

**建议分类**：药物研发 💊、医疗科技 🏥、公共卫生 🌍、临床研究 🔬、行业动态 📋

#### 游戏

```json
{
  "rss_feeds": [
    { "url": "https://www.ign.com/articles.rss", "name": "IGN", "group": "综合游戏", "enabled": true },
    { "url": "https://www.gamespot.com/feeds/mashup/", "name": "GameSpot", "group": "综合游戏", "enabled": true },
    { "url": "https://kotaku.com/rss", "name": "Kotaku", "group": "综合游戏", "enabled": true },
    { "url": "https://www.polygon.com/rss/index.xml", "name": "Polygon", "group": "综合游戏", "enabled": true },
    { "url": "https://www.eurogamer.net/feed", "name": "Eurogamer", "group": "综合游戏", "enabled": true },
    { "url": "https://www.pcgamer.com/rss/", "name": "PC Gamer", "group": "PC 游戏", "enabled": true },
    { "url": "https://www.rockpapershotgun.com/feed", "name": "Rock Paper Shotgun", "group": "PC 游戏", "enabled": true },
    { "url": "https://www.gamedeveloper.com/rss.xml", "name": "Game Developer", "group": "游戏开发", "enabled": true },
    { "url": "https://store.steampowered.com/feeds/news/", "name": "Steam News", "group": "平台动态", "enabled": true },
    { "url": "https://rsshub.app/3dm/news", "name": "3DM 游戏网", "group": "中文游戏", "enabled": true },
    { "url": "https://rsshub.app/gamersky/news", "name": "游民星空", "group": "中文游戏", "enabled": true }
  ]
}
```

**建议分类**：新作发布 🎮、游戏评测 ⭐、行业动态 📰、电竞赛事 🏆、独立游戏 🕹️

#### 娱乐影视

```json
{
  "rss_feeds": [
    { "url": "https://variety.com/feed/", "name": "Variety", "group": "好莱坞", "enabled": true },
    { "url": "https://deadline.com/feed/", "name": "Deadline", "group": "好莱坞", "enabled": true },
    { "url": "https://www.hollywoodreporter.com/feed/", "name": "Hollywood Reporter", "group": "好莱坞", "enabled": true },
    { "url": "https://www.billboard.com/feed/", "name": "Billboard", "group": "音乐", "enabled": true },
    { "url": "https://pitchfork.com/feed/feed-news/rss", "name": "Pitchfork", "group": "音乐", "enabled": true },
    { "url": "https://www.rollingstone.com/feed/", "name": "Rolling Stone", "group": "音乐", "enabled": true },
    { "url": "https://collider.com/feed/", "name": "Collider", "group": "影视", "enabled": true },
    { "url": "https://screenrant.com/feed/", "name": "Screen Rant", "group": "影视", "enabled": true },
    { "url": "https://rsshub.app/douban/movie/playing", "name": "豆瓣热映", "group": "中文影视", "enabled": true },
    { "url": "https://rsshub.app/bilibili/ranking/0/3/1", "name": "B站热门", "group": "中文娱乐", "enabled": true }
  ]
}
```

**建议分类**：影视动态 🎬、音乐 🎵、综艺节目 📺、明星八卦 ⭐、票房榜单 🏆

#### 科学教育

```json
{
  "rss_feeds": [
    { "url": "https://www.sciencedaily.com/rss/all.xml", "name": "Science Daily", "group": "科学新闻", "enabled": true },
    { "url": "https://www.newscientist.com/feed/home/", "name": "New Scientist", "group": "科学新闻", "enabled": true },
    { "url": "https://feeds.nature.com/nature/rss/current", "name": "Nature", "group": "学术期刊", "enabled": true },
    { "url": "https://www.science.org/action/showFeed?type=etoc&feed=rss&jc=science", "name": "Science", "group": "学术期刊", "enabled": true },
    { "url": "https://phys.org/rss-feed/", "name": "Phys.org", "group": "科学新闻", "enabled": true },
    { "url": "https://www.quantamagazine.org/feed/", "name": "Quanta Magazine", "group": "科普", "enabled": true },
    { "url": "https://news.mit.edu/rss/feed", "name": "MIT News", "group": "高校研究", "enabled": true },
    { "url": "https://www.technologyreview.com/feed/", "name": "MIT Tech Review", "group": "科技评论", "enabled": true },
    { "url": "https://www.edsurge.com/articles_rss", "name": "EdSurge", "group": "教育科技", "enabled": true },
    { "url": "https://rsshub.app/zhihu/hotlist", "name": "知乎热榜", "group": "中文知识", "enabled": true }
  ]
}
```

**建议分类**：前沿发现 🔬、太空探索 🚀、生命科学 🧬、教育科技 📚、科普解读 💡

#### 体育

```json
{
  "rss_feeds": [
    { "url": "https://www.espn.com/espn/rss/news", "name": "ESPN", "group": "综合体育", "enabled": true },
    { "url": "https://sports.yahoo.com/rss/", "name": "Yahoo Sports", "group": "综合体育", "enabled": true },
    { "url": "https://www.skysports.com/rss/12040", "name": "Sky Sports", "group": "综合体育", "enabled": true },
    { "url": "https://www.bbc.com/sport/rss.xml", "name": "BBC Sport", "group": "综合体育", "enabled": true },
    { "url": "https://theathletic.com/feed/", "name": "The Athletic", "group": "深度报道", "enabled": true },
    { "url": "https://bleacherreport.com/articles/feed", "name": "Bleacher Report", "group": "综合体育", "enabled": true },
    { "url": "https://www.nba.com/feed/", "name": "NBA Official", "group": "篮球", "enabled": true },
    { "url": "https://rsshub.app/hupu/bxj", "name": "虎扑步行街", "group": "中文体育", "enabled": true },
    { "url": "https://rsshub.app/dongqiudi/top_news", "name": "懂球帝", "group": "中文足球", "enabled": true }
  ]
}
```

**建议分类**：足球 ⚽、篮球 🏀、赛事速递 🏆、转会市场 💰、深度分析 📊

#### 设计创意

```json
{
  "rss_feeds": [
    { "url": "https://www.designboom.com/feed/", "name": "Designboom", "group": "设计媒体", "enabled": true },
    { "url": "https://www.dezeen.com/feed/", "name": "Dezeen", "group": "建筑设计", "enabled": true },
    { "url": "https://www.creativebloq.com/feed", "name": "Creative Bloq", "group": "创意设计", "enabled": true },
    { "url": "https://www.itsnicethat.com/feed", "name": "It's Nice That", "group": "创意灵感", "enabled": true },
    { "url": "https://www.fastcompany.com/section/design/rss", "name": "Fast Co. Design", "group": "设计商业", "enabled": true },
    { "url": "https://uxdesign.cc/feed", "name": "UX Collective", "group": "UX 设计", "enabled": true },
    { "url": "https://alistapart.com/main/feed/", "name": "A List Apart", "group": "Web 设计", "enabled": true },
    { "url": "https://www.smashingmagazine.com/feed/", "name": "Smashing Magazine", "group": "Web 设计", "enabled": true }
  ]
}
```

**建议分类**：产品设计 🎨、建筑空间 🏛️、品牌视觉 ✨、UX/UI 📱、设计趋势 📐

> **提示**：部分中文源使用 [RSSHub](https://docs.rsshub.app/) 路由，需自建或使用公共 RSSHub 实例。如果 RSS 源不可用，可在 Admin UI 的「新闻源管理」中禁用。

### 2. 修改分类

在 `config/settings.json` 中修改 `categories_order`，并在 `src/fetch_news.py` 中更新 `CATEGORY_ICONS`。

**示例 — 金融领域**：
```python
CATEGORY_ICONS = {
    "宏观经济": "📈",
    "股市行情": "📊",
    "公司动态": "🏢",
    "金融监管": "⚖️",
    "投资理财": "💰",
}
```

### 3. 自定义 Claude 筛选 Prompt

两种方式：
- **Admin UI**：在「设置」页面的「自定义 Prompt」输入框中编写
- **代码修改**：在 `src/fetch_news.py` 的 `get_prompt_for_mode()` 中修改 prompt

Prompt 中需要定义：筛选范围、分类规则、摘要风格。

## 项目结构

```
github-project/
├── .github/workflows/
│   ├── fetch-news.yml        # Sleep-based: 低峰期 cron 触发，sleep 到 send_time - 30min 抓取
│   ├── send-ch-email.yml     # Per-channel send: Fetch 完成后触发，sleep 到 send_time 发送
│   ├── send-ch-default.yml   # Per-channel send: 同上，每个频道一个工作流
│   ├── send-ch-<id>.yml      # Per-channel send: 其他 webhook 频道
│   └── deploy-admin.yml      # Admin UI 部署到 GitHub Pages
├── src/
│   ├── main.py            # 主程序入口（fetch/send/webhook/full 四种模式）
│   ├── fetch_news.py      # RSS 抓取 + Claude AI 分类 + 邮件模板
│   ├── send_email.py      # SMTP 邮件发送
│   └── send_webhook.py    # Webhook 群聊推送（默认 RedCity，可替换）
├── admin/                 # Admin UI（React + GitHub REST API）
│   └── src/
│       ├── pages/
│       │   ├── Dashboard.jsx      # 仪表盘（频道卡片、工作流状态、源健康）
│       │   ├── ChannelDetail.jsx  # 频道详情（草稿审核/编辑/收件人/历史/模板）
│       │   ├── Sources.jsx        # 新闻源管理
│       │   ├── Settings.jsx       # 设置（频道管理/Secrets/过滤/自定义 Prompt）
│       │   └── Login.jsx          # 登录
│       └── lib/
│           ├── github.js       # GitHub REST API 封装
│           ├── claude.js       # Claude API（浏览器端摘要生成）
│           └── emailTemplate.js # JS 版邮件模板（预览用）
├── config/
│   ├── settings.json      # 全局配置（频道、RSS 源、分类、过滤规则等）
│   └── drafts/            # 每日新闻草稿（自动清理 30 天前）
│       ├── YYYY-MM-DD.json           # 全局草稿
│       └── YYYY-MM-DD_ch_<id>.json   # 各频道独立草稿
└── requirements.txt
```

## 配置项

### GitHub Secrets

| Secret | 必填 | 说明 |
|--------|------|------|
| `ANTHROPIC_API_KEY` | 是 | Anthropic API 密钥 |
| `MINIMAX_API_KEY` | 否 | MiniMax M2.1 API 密钥（备选模型，可选） |
| `DEEPSEEK_API_KEY` | 否 | DeepSeek API 密钥（备选模型，可选） |
| `SMTP_USERNAME` | 是 | 发件邮箱地址 |
| `SMTP_PASSWORD` | 是 | 邮箱授权码 |
| `EMAIL_RECIPIENTS` | 是 | 收件人邮箱（逗号分隔多个） |
| `ADMIN_EMAIL` | 否 | 管理员通知邮箱（工作流失败时通知） |
| `WEBHOOK_KEYS` | 否 | JSON 格式的 webhook key 映射 |
| `WEBHOOK_KEY_1` ~ `WEBHOOK_KEY_20` | 否 | Webhook 密钥槽位（向后兼容） |

### settings.json 核心字段

| 字段 | 说明 |
|------|------|
| `timezone` | 时区（支持 18 个预设） |
| `channels` | 频道数组，每个频道包含：`id`, `type`(email/webhook), `name`, `enabled`, `send_hour`, `send_minute`, `topic_mode`, `max_news_items`, `webhook_key_slot` (number, 1-20, webhook only) — maps to `WEBHOOK_KEY_{N}` GitHub Secret |
| `webhook_url_base` | 全局 Webhook URL（频道可单独覆盖） |
| `categories_order` | 分类显示顺序 |
| `rss_feeds` | RSS 源列表（URL、名称、分组、启用状态） |
| `filters` | 黑白名单过滤规则（关键词/来源） |
| `custom_prompt` | 自定义 Claude 筛选 Prompt（留空则使用主题模式默认） |

### 草稿状态机

```
pending_review → approved → sent
       │
       └──→ rejected
```

草稿来源 (source):
- "scheduled": 定时 cron 触发的抓取
- "manual": 手动触发的抓取（测试用）

Per-channel send 规则:
- 每个频道有独立的 send-ch-<id>.yml 工作流（双 Job: pre-check → send-channel）
- Fetch News 完成后自动触发所有 send 工作流
- pre-check 检查草稿: 不存在/sent/rejected/manual+pending_review → should_send=false（UI 显示 skipped）
- send-channel: sleep 到 send_time → 发送（0 条新闻跳过，防空消息）
- manual 草稿必须先批准，scheduled 草稿不会覆盖 manual 草稿
- Webhook 重试: API 拒绝(如消息过大)→减条重试; 网络错误→不重试(防重复)

## 每日自动流程（Sleep-based 架构）

```
低峰期 cron (UTC 22:00 / CST 06:00)
  → fetch-news.yml sleep 到 earliest send_time - 30min
  → 检查草稿是否需要抓取（不存在 or 过期 >2h）
  → 抓取 RSS → Claude 分类/摘要 → 保存草稿 → commit + push
  → 触发所有 send-ch-*.yml 工作流（workflow_run event）
      ↓
各 send-ch-<id>.yml 并行执行:
  → pre-check: 草稿不可发 → skip（UI 显示灰色 skipped）
  → send-channel: sleep 到 send_time → pull 最新编辑 → send --channel <id>
  → commit 发送状态 → push（5 次重试, --theirs 保留本地 sent）
```

- Admin UI 可随时审核/编辑/删除/拒绝各频道草稿
- "批准发送" 按钮会同时触发对应频道的发送工作流
- 已发送或已拒绝的草稿会跳过
- 过期的 pending_review 草稿（scheduled + >2h old）会触发重新抓取

## 主题模式

系统内置两种模式，用户也可通过自定义 Prompt 创建任意模式。

**泛领域模式 (broad)**：使用 `categories_order` 中定义的分类，适合覆盖整个领域。

**聚焦模式 (focused)**：重点关注某个子领域，该子领域的 RSS 源不受「每源 3 篇」限制，所有新闻全部保留。适合对特定方向有深入需求的场景。

## 邮件服务配置

| 邮箱 | SMTP Host | Port |
|------|-----------|------|
| QQ 邮箱 | smtp.qq.com | 587 |
| Gmail | smtp.gmail.com | 587 |
| Outlook | smtp.office365.com | 587 |
| 163 邮箱 | smtp.163.com | 465 |

## 快速上手

1. Fork 本仓库
2. 配置 GitHub Secrets（至少 `ANTHROPIC_API_KEY` + `SMTP_USERNAME` + `SMTP_PASSWORD` + `EMAIL_RECIPIENTS`）
3. 修改 `config/settings.json` 中的 RSS 源和分类（适配你的领域）
4. 部署 Admin UI（push 到 main 分支会自动触发 deploy-admin.yml）
5. 在 Admin UI 中微调设置，等待每日自动推送
