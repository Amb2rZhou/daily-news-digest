# 微信公众号 RSS 获取指南

微信公众号没有官方 RSS，需要通过第三方服务获取。

## 方案对比

| 方案 | 费用 | 稳定性 | 推荐 |
|------|------|--------|------|
| **WeWe RSS** (自建) | 免费 | 较稳定 | ✅ 推荐 |
| Wechat2RSS | 免费300个/付费自建 | 一般 | 部分公众号 |
| feeddd/Hamibot | 免费 | 不稳定 | 补充用 |
| WeRSS | 付费 | 稳定 | 预算充足时 |

## WeWe RSS 搭建（推荐方案）

### 原理
基于**微信读书**平台抓取公众号文章，生成 RSS 订阅源。

### 部署到 Zeabur（一键部署）

1. 打开 https://zeabur.com/templates/DI9BBD
2. 用 GitHub 账号登录
3. 填写子域名（如 `wewe-rss-yourname`）
4. 选择 Region（推荐 Asia/Singapore）
5. 点击确定，等待部署完成

### 配置

部署完成后，在 Zeabur 控制台 → Variables 中找到自动生成的 `AUTH_CODE`。

### 登录

1. 打开 `https://你的域名.zeabur.app`
2. 输入 AUTH_CODE 登录管理页面
3. 进入「账号管理」→ 添加微信读书账号
4. 用微信扫码授权
5. **不要**勾选"24小时后自动退出"

### 添加公众号

1. 进入「公众号源」页面
2. 粘贴该公众号的**任意一篇文章链接**
   - 链接格式：`https://mp.weixin.qq.com/s/xxxxx`
   - 可以在微信中打开公众号文章 → 右上角 → 复制链接
3. 每个公众号添加后会自动生成 RSS 链接
4. **注意**：添加频率不要太快，否则会触发限制

### 获取 RSS 链接

每个公众号生成三种格式：
```
https://你的域名.zeabur.app/feeds/{feed-id}.rss   # RSS 2.0
https://你的域名.zeabur.app/feeds/{feed-id}.atom  # Atom
https://你的域名.zeabur.app/feeds/{feed-id}.json  # JSON Feed
```

使用 `.rss` 格式即可。

## 已找到的免费 RSS 来源

以下公众号已有公开的免费 RSS（无需自建）：

| 公众号 | RSS 来源 | URL |
|--------|----------|-----|
| 夕小瑶科技说 | Wechat2RSS | `https://wechat2rss.xlab.app/feed/a1cd365aa14ed7d64cabfc8aa086da40ecaba34d.xml` |
| 腾讯技术工程 | Wechat2RSS | `https://wechat2rss.xlab.app/feed/9685937b45fe9c7a526dbc32e4f24ba879a65b9a.xml` |
| 白鲸出海 | feeddd | `https://feed.hamibot.com/api/feeds/6131b5301269c358aa0dec25` |
| 晚点LatePost | feeddd | `https://feed.hamibot.com/api/feeds/6121d8a451e2511a8279faaf` |
| 海外独角兽 | feeddd | `https://feed.hamibot.com/api/feeds/613570931269c358aa0f0cca` |

## 需要通过 WeWe RSS 自建获取的公众号

以下公众号暂无公开 RSS，需要自建 WeWe RSS 后添加：

- 腾讯研究院
- AGI Hunt
- 腾讯科技
- Web3天空之城
- 老刘说NLP
- founder park
- AI炼金术
- 十字路口crossing
- 归藏的AI工具箱
