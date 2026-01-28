# Daily News Digest

自动化 AI/科技新闻日报，每天定时发送邮件。

## 功能

- 使用 Anthropic Claude API 搜索和整理新闻
- 自动去重、排序、筛选最重要的新闻
- 通过 QQ 邮箱 SMTP 发送邮件
- GitHub Actions 每天定时执行

## 配置 GitHub Secrets

在 GitHub 仓库的 Settings → Secrets and variables → Actions 中添加以下 secrets：

| Secret 名称 | 说明 | 示例 |
|------------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 | sk-ant-xxx |
| `SMTP_USERNAME` | QQ 邮箱地址 | 123456@qq.com |
| `SMTP_PASSWORD` | QQ 邮箱授权码 | abcdefghijklmnop |
| `EMAIL_RECIPIENTS` | 收件人列表（逗号分隔） | a@example.com,b@example.com |

## 手动触发

1. 进入 GitHub 仓库的 Actions 页面
2. 选择 "Daily News Digest" workflow
3. 点击 "Run workflow"

## 定时执行

默认每天北京时间 18:00 自动执行。

如需修改时间，编辑 `.github/workflows/daily-news.yml` 中的 cron 表达式：

```yaml
schedule:
  - cron: '0 10 * * *'  # UTC 10:00 = 北京时间 18:00
```

## 本地运行

```bash
# 安装依赖
pip install -r requirements.txt

# 设置环境变量
export ANTHROPIC_API_KEY="your-api-key"
export SMTP_USERNAME="your-qq@qq.com"
export SMTP_PASSWORD="your-auth-code"
export EMAIL_RECIPIENTS="recipient@example.com"

# 运行
cd src
python main.py
```

## 项目结构

```
.
├── .github/workflows/
│   └── daily-news.yml    # GitHub Actions 配置
├── src/
│   ├── main.py           # 主程序
│   ├── fetch_news.py     # 新闻获取
│   └── send_email.py     # 邮件发送
├── requirements.txt
└── README.md
```
