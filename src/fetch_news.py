#!/usr/bin/env python3
"""
Fetch AI/Tech news using Anthropic Claude API with web search.
"""

import anthropic
import json
import os
from datetime import datetime, timedelta

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

def fetch_news(api_key: str, topic: str = "AI/科技", max_items: int = 10) -> dict:
    """Fetch news using Claude API with web search."""

    client = anthropic.Anthropic(api_key=api_key)

    start_time, end_time = get_time_window(18)
    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")

    prompt = f"""请搜索并整理 {topic} 领域在以下时间窗口内的重要新闻：

时间窗口：{start_time} ~ {end_time}

要求：
1. 搜索查询必须包含精确日期（{yesterday} 和 {today}）
2. 只收集时间窗口内发布的新闻，排除旧闻
3. 去重合并：相同事件的多篇报道合并为一条
4. 按重要性排序（全球影响 > 行业影响 > 区域影响）
5. 最多返回 {max_items} 条新闻
6. 优先选择权威来源（TechCrunch, The Verge, 36氪, 机器之心等）

请以 JSON 格式返回，结构如下：
{{
  "date": "{today}",
  "time_window": "{start_time} ~ {end_time}",
  "news": [
    {{
      "title": "新闻标题",
      "summary": "1-2句摘要",
      "source": "来源名称",
      "url": "来源链接"
    }}
  ]
}}

只返回 JSON，不要其他文字。"""

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}]
    )

    # Extract JSON from response
    response_text = response.content[0].text

    # Try to parse JSON
    try:
        # Find JSON in response
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}') + 1
        if start_idx != -1 and end_idx > start_idx:
            json_str = response_text[start_idx:end_idx]
            return json.loads(json_str)
    except json.JSONDecodeError:
        pass

    # Return empty result if parsing fails
    return {
        "date": today,
        "time_window": f"{start_time} ~ {end_time}",
        "news": [],
        "error": "Failed to parse news response"
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
            lines.append(f"{i}. {item['title']}")
            lines.append(f"   {item['summary']}")
            lines.append(f"   链接: {item['url']}")
            lines.append("")

    lines.extend([
        "---",
        "由 AI News Assistant 自动生成"
    ])

    return "\n".join(lines)

if __name__ == "__main__":
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("Error: ANTHROPIC_API_KEY environment variable not set")
        exit(1)

    news_data = fetch_news(api_key)
    print(json.dumps(news_data, ensure_ascii=False, indent=2))
