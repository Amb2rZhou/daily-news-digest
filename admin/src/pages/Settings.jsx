import React, { useState, useEffect } from 'react'
import { readFile, writeFile, updateWorkflowCron } from '../lib/github'
import { getAnthropicKey, setAnthropicKey, hasAnthropicKey } from '../lib/claude'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow)',
  marginBottom: 20,
}

const TIMEZONE_OPTIONS = [
  { value: 'Asia/Shanghai', label: '中国标准时间 (UTC+8)' },
  { value: 'Asia/Tokyo', label: '日本标准时间 (UTC+9)' },
  { value: 'Asia/Singapore', label: '新加坡时间 (UTC+8)' },
  { value: 'Asia/Hong_Kong', label: '香港时间 (UTC+8)' },
  { value: 'Asia/Taipei', label: '台北时间 (UTC+8)' },
  { value: 'Asia/Seoul', label: '韩国标准时间 (UTC+9)' },
  { value: 'Asia/Kolkata', label: '印度标准时间 (UTC+5:30)' },
  { value: 'Asia/Dubai', label: '海湾标准时间 (UTC+4)' },
  { value: 'Europe/London', label: '英国时间 (UTC+0/+1)' },
  { value: 'Europe/Paris', label: '中欧时间 (UTC+1/+2)' },
  { value: 'Europe/Berlin', label: '德国时间 (UTC+1/+2)' },
  { value: 'Europe/Moscow', label: '莫斯科时间 (UTC+3)' },
  { value: 'America/New_York', label: '美东时间 (UTC-5/-4)' },
  { value: 'America/Chicago', label: '美中时间 (UTC-6/-5)' },
  { value: 'America/Denver', label: '美山地时间 (UTC-7/-6)' },
  { value: 'America/Los_Angeles', label: '美西时间 (UTC-8/-7)' },
  { value: 'Pacific/Auckland', label: '新西兰时间 (UTC+12/+13)' },
  { value: 'Australia/Sydney', label: '澳东时间 (UTC+10/+11)' },
]

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [sha, setSha] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [newBlacklistKw, setNewBlacklistKw] = useState('')
  const [newBlacklistSrc, setNewBlacklistSrc] = useState('')
  const [newWhitelistKw, setNewWhitelistKw] = useState('')
  const [newWhitelistSrc, setNewWhitelistSrc] = useState('')
  const [apiKey, setApiKey] = useState(() => getAnthropicKey())
  const [apiKeySaved, setApiKeySaved] = useState(() => hasAnthropicKey())

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const file = await readFile('config/settings.json')
      if (file) {
        setSettings(JSON.parse(file.content))
        setSha(file.sha)
      }
    } catch (e) {
      console.error('Load settings error:', e)
    }
    setLoading(false)
  }

  function update(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  function updateFilter(key, value) {
    setSettings(prev => ({
      ...prev,
      filters: { ...prev.filters, [key]: value }
    }))
  }

  function addToList(filterKey, value, setter) {
    if (!value.trim()) return
    const current = settings.filters?.[filterKey] || []
    if (!current.includes(value.trim())) {
      updateFilter(filterKey, [...current, value.trim()])
    }
    setter('')
  }

  function removeFromList(filterKey, idx) {
    const current = [...(settings.filters?.[filterKey] || [])]
    current.splice(idx, 1)
    updateFilter(filterKey, current)
  }

  function moveCategoryUp(idx) {
    if (idx === 0) return
    const order = [...settings.categories_order]
    ;[order[idx - 1], order[idx]] = [order[idx], order[idx - 1]]
    update('categories_order', order)
  }

  function moveCategoryDown(idx) {
    const order = [...settings.categories_order]
    if (idx >= order.length - 1) return
    ;[order[idx], order[idx + 1]] = [order[idx + 1], order[idx]]
    update('categories_order', order)
  }

  async function save() {
    if (!settings) return
    setSaving(true)
    try {
      const content = JSON.stringify(settings, null, 2) + '\n'
      const result = await writeFile(
        'config/settings.json',
        content,
        'Update settings via admin UI',
        sha
      )
      setSha(result.content.sha)

      // Also update workflow cron
      const sendHour = settings.send_hour ?? 18
      const sendMinute = settings.send_minute ?? 0
      const utcHour = (sendHour - 8 + 24) % 24
      const newCron = `${sendMinute} ${utcHour} * * *`
      try {
        await updateWorkflowCron(newCron)
      } catch (e) {
        console.warn('Could not update workflow cron:', e)
      }

      alert('设置已保存')
    } catch (e) {
      alert('保存失败: ' + e.message)
    }
    setSaving(false)
  }

  if (loading) return <p style={{ color: 'var(--text2)' }}>加载中...</p>
  if (!settings) return <p style={{ color: 'var(--text2)' }}>无法加载设置</p>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, flex: 1 }}>设置</h1>
        <button
          onClick={save}
          disabled={saving}
          style={{ padding: '8px 24px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 500 }}
        >
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>

      {/* Basic settings */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>基本设置</h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>发送时间</span>
            <input
              type="time"
              value={`${String(settings.send_hour ?? 18).padStart(2, '0')}:${String(settings.send_minute ?? 0).padStart(2, '0')}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map(Number)
                update('send_hour', h)
                update('send_minute', m)
              }}
              style={{ width: '100%' }}
            />
          </label>

          <label>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>最大新闻条数</span>
            <input
              type="number"
              min={1}
              max={30}
              value={settings.max_news_items}
              onChange={(e) => update('max_news_items', parseInt(e.target.value) || 10)}
              style={{ width: '100%' }}
            />
          </label>

          <label style={{ gridColumn: '1 / -1' }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>时区</span>
            <select
              value={settings.timezone}
              onChange={(e) => update('timezone', e.target.value)}
              style={{ width: '100%' }}
            >
              {TIMEZONE_OPTIONS.map(tz => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
              {!TIMEZONE_OPTIONS.some(tz => tz.value === settings.timezone) && (
                <option value={settings.timezone}>{settings.timezone}</option>
              )}
            </select>
          </label>
        </div>
      </div>

      {/* Topic Mode */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>主题模式</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 12, padding: 16,
            background: settings.topic_mode === 'broad' ? '#eef2ff' : '#f9fafb',
            border: settings.topic_mode === 'broad' ? '2px solid #6366f1' : '1px solid var(--border)',
            borderRadius: 8, cursor: 'pointer',
          }}>
            <input
              type="radio"
              name="topic_mode"
              value="broad"
              checked={settings.topic_mode === 'broad' || !settings.topic_mode}
              onChange={() => update('topic_mode', 'broad')}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>泛 AI 模式</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                覆盖 AI 全领域：模型发布、公司动态、融资、产品、政策、应用落地、机器人、自动驾驶等
              </div>
            </div>
          </label>
          <label style={{
            display: 'flex', alignItems: 'flex-start', gap: 12, padding: 16,
            background: settings.topic_mode === 'focused' ? '#fef3c7' : '#f9fafb',
            border: settings.topic_mode === 'focused' ? '2px solid #d97706' : '1px solid var(--border)',
            borderRadius: 8, cursor: 'pointer',
          }}>
            <input
              type="radio"
              name="topic_mode"
              value="focused"
              checked={settings.topic_mode === 'focused'}
              onChange={() => update('topic_mode', 'focused')}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>🎯 聚焦模式</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                重点关注三个方向：<br/>
                • 智能硬件（AR/VR/MR/XR、智能穿戴、空间计算）<br/>
                • AI 技术及产品进展（模型能力、新产品形态、新范式）<br/>
                • 巨头动向和行业观察
              </div>
              <div style={{ fontSize: 12, color: '#d97706', marginTop: 8, fontWeight: 500 }}>
                ✨ 每条新闻附带 AI 评论/未来推演
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Custom Prompt */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>自定义 Prompt</h2>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
          高级选项：直接输入自定义 Prompt 控制 AI 筛选逻辑。留空则使用上方主题模式的默认 Prompt。
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={!!settings.custom_prompt}
              onChange={(e) => {
                if (e.target.checked) {
                  update('custom_prompt', `以下是最近24小时内从多个来源抓取的新闻列表。请帮我筛选和整理。

**你的筛选要求写在这里**

新闻列表：
{articles_text}

请以 JSON 格式返回，最多选 {max_items} 条新闻，结构如下：
{{
  "categories": [
    {{
      "name": "类别名",
      "icon": "emoji",
      "news": [
        {{
          "title": "新闻标题",
          "summary": "1-2句摘要",
          "source": "来源",
          "url": "链接"
        }}
      ]
    }}
  ]
}}

可用类别：{category_names}
icon 映射：{icon_mapping}
只返回合法的 JSON，不要其他文字。`)
                } else {
                  update('custom_prompt', '')
                }
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 500 }}>启用自定义 Prompt</span>
          </label>
          {settings.custom_prompt && (
            <span style={{ fontSize: 12, color: '#d97706', fontWeight: 500 }}>
              ⚠️ 自定义 Prompt 优先于主题模式
            </span>
          )}
        </div>

        {settings.custom_prompt && (
          <>
            <textarea
              value={settings.custom_prompt}
              onChange={(e) => update('custom_prompt', e.target.value)}
              placeholder="输入自定义 Prompt..."
              style={{
                width: '100%',
                minHeight: 300,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
                fontSize: 13,
                lineHeight: 1.5,
                padding: 12,
                borderRadius: 6,
                border: '1px solid var(--border)',
                resize: 'vertical',
              }}
            />
            <div style={{
              marginTop: 12, padding: 12, background: '#f0f9ff', borderRadius: 6,
              border: '1px solid #bae6fd', fontSize: 12, color: '#0369a1',
            }}>
              <strong>可用变量：</strong>
              <ul style={{ margin: '8px 0 0 0', paddingLeft: 20 }}>
                <li><code>{'{articles_text}'}</code> - 新闻文章列表</li>
                <li><code>{'{max_items}'}</code> - 最大新闻条数</li>
                <li><code>{'{category_names}'}</code> - 分类名称（用、连接）</li>
                <li><code>{'{icon_mapping}'}</code> - 分类图标映射</li>
                <li><code>{'{category_json_example}'}</code> - JSON 结构示例</li>
              </ul>
              <div style={{ marginTop: 8, color: '#64748b' }}>
                提示：确保 Prompt 要求返回合法的 JSON 格式，否则解析会失败。
              </div>
            </div>
          </>
        )}
      </div>

      {/* Category order */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>分类排序</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(settings.categories_order || []).map((cat, idx) => (
            <div key={cat} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', background: '#f9fafb', borderRadius: 6,
              border: '1px solid var(--border)',
            }}>
              <span style={{ flex: 1, fontSize: 14 }}>{cat}</span>
              <button
                onClick={() => moveCategoryUp(idx)}
                disabled={idx === 0}
                style={{ padding: '2px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}
              >
                ▲
              </button>
              <button
                onClick={() => moveCategoryDown(idx)}
                disabled={idx === (settings.categories_order || []).length - 1}
                style={{ padding: '2px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}
              >
                ▼
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>过滤规则</h2>

        <FilterList
          label="黑名单关键词"
          items={settings.filters?.blacklist_keywords || []}
          value={newBlacklistKw}
          onChange={setNewBlacklistKw}
          onAdd={() => addToList('blacklist_keywords', newBlacklistKw, setNewBlacklistKw)}
          onRemove={(idx) => removeFromList('blacklist_keywords', idx)}
        />

        <FilterList
          label="黑名单来源"
          items={settings.filters?.blacklist_sources || []}
          value={newBlacklistSrc}
          onChange={setNewBlacklistSrc}
          onAdd={() => addToList('blacklist_sources', newBlacklistSrc, setNewBlacklistSrc)}
          onRemove={(idx) => removeFromList('blacklist_sources', idx)}
        />

        <FilterList
          label="白名单关键词"
          items={settings.filters?.whitelist_keywords || []}
          value={newWhitelistKw}
          onChange={setNewWhitelistKw}
          onAdd={() => addToList('whitelist_keywords', newWhitelistKw, setNewWhitelistKw)}
          onRemove={(idx) => removeFromList('whitelist_keywords', idx)}
        />

        <FilterList
          label="白名单来源"
          items={settings.filters?.whitelist_sources || []}
          value={newWhitelistSrc}
          onChange={setNewWhitelistSrc}
          onAdd={() => addToList('whitelist_sources', newWhitelistSrc, setNewWhitelistSrc)}
          onRemove={(idx) => removeFromList('whitelist_sources', idx)}
        />
      </div>

      {/* Webhook settings */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>Webhook 推送</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={settings.webhook_enabled ?? false}
              onChange={(e) => update('webhook_enabled', e.target.checked)}
            />
            <span style={{ fontSize: 13, fontWeight: 500 }}>启用 Webhook 群聊推送</span>
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Webhook URL Base</span>
            <input
              type="text"
              value={settings.webhook_url_base ?? ''}
              onChange={(e) => update('webhook_url_base', e.target.value)}
              placeholder="https://redcity-open.xiaohongshu.com/api/robot/webhook/send"
              style={{ width: '100%' }}
            />
            <span style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4, display: 'block' }}>
              完整 URL = base + ?key= + WEBHOOK_KEY (密钥在「密钥管理」页设置)
            </span>
          </label>
        </div>
      </div>

      {/* Anthropic API Key */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>AI 辅助设置</h2>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Anthropic API Key</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
          设置后可在添加新闻时使用 AI 自动生成摘要。Key 仅存储在浏览器本地。
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="password"
            value={apiKey}
            onChange={e => { setApiKey(e.target.value); setApiKeySaved(false) }}
            placeholder="sk-ant-..."
            style={{ flex: 1 }}
          />
          <button
            onClick={() => {
              setAnthropicKey(apiKey)
              setApiKeySaved(true)
            }}
            style={{
              padding: '6px 16px', background: 'var(--primary-light)', color: 'var(--primary)',
              border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer',
            }}
          >
            保存
          </button>
          {apiKey && (
            <button
              onClick={() => {
                setApiKey('')
                setAnthropicKey('')
                setApiKeySaved(false)
              }}
              style={{
                padding: '6px 16px', background: '#fee2e2', color: '#dc2626',
                border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer',
              }}
            >
              清除
            </button>
          )}
        </div>
        {apiKeySaved && apiKey && (
          <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 6 }}>API Key 已保存</div>
        )}
        {!apiKey && (
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>未设置</div>
        )}
      </div>
    </div>
  )
}

function FilterList({ label, items, value, onChange, onAdd, onRemove }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{label}</div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAdd()}
          placeholder={`输入${label}...`}
          style={{ flex: 1 }}
        />
        <button
          onClick={onAdd}
          style={{ padding: '6px 16px', background: 'var(--primary-light)', color: 'var(--primary)', border: 'none', borderRadius: 6, fontSize: 13 }}
        >
          添加
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {items.map((item, idx) => (
          <span key={idx} style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: '#f3f4f6', padding: '4px 10px', borderRadius: 16, fontSize: 12,
          }}>
            {item}
            <button onClick={() => onRemove(idx)} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 0, fontSize: 14 }}>
              &times;
            </button>
          </span>
        ))}
        {items.length === 0 && <span style={{ color: 'var(--text3)', fontSize: 12 }}>暂无</span>}
      </div>
    </div>
  )
}
