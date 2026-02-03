const STORAGE_KEY = 'anthropic_api_key'

export function getAnthropicKey() {
  return localStorage.getItem(STORAGE_KEY) || ''
}

export function setAnthropicKey(key) {
  if (key) {
    localStorage.setItem(STORAGE_KEY, key)
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }
}

export function hasAnthropicKey() {
  return !!localStorage.getItem(STORAGE_KEY)
}

export async function generateSummary(title, url) {
  const key = getAnthropicKey()
  if (!key) throw new Error('Anthropic API Key 未设置')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `请为以下新闻生成1-2句中文摘要，直接输出摘要内容，不要加前缀：\n标题：${title}\nURL：${url}`,
      }],
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error?.message || `API 请求失败: ${res.status}`)
  }

  const data = await res.json()
  return data.content?.[0]?.text?.trim() || ''
}
