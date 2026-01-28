#!/usr/bin/env python3
"""
Main script for daily news digest.
Fetches news using RSS feeds + Claude and sends email.
"""

import os
import sys
from datetime import datetime

from fetch_news import fetch_news, format_email_body
from send_email import send_email

def main():
    print(f"=== AI/科技新闻日报 ===")
    print(f"运行时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    # Check required environment variables
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    if not anthropic_key:
        print("❌ Error: ANTHROPIC_API_KEY not set")
        sys.exit(1)

    # Fetch news
    print("📰 正在获取新闻...")
    topic = os.environ.get("NEWS_TOPIC", "AI/科技")
    max_items = int(os.environ.get("NEWS_MAX_ITEMS", "10"))

    news_data = fetch_news(anthropic_key, topic=topic, max_items=max_items)

    if news_data.get("error"):
        print(f"⚠️ Warning: {news_data['error']}")

    news_count = len(news_data.get("news", []))
    print(f"✅ 获取到 {news_count} 条新闻")
    print()

    # Format email
    email_body = format_email_body(news_data)
    email_subject = f"AI/科技新闻日报 - {news_data['date']}"

    # Print preview
    print("📧 邮件预览:")
    print("-" * 40)
    print(email_body)
    print("-" * 40)
    print()

    # Send email
    print("📤 正在发送邮件...")
    success = send_email(subject=email_subject, body=email_body)

    if success:
        print()
        print("✅ 任务完成！")
        sys.exit(0)
    else:
        print()
        print("❌ 邮件发送失败")
        sys.exit(1)

if __name__ == "__main__":
    main()
