import React, { useState, useEffect } from 'react'
import { readFile, writeFile, listSecrets, getPublicKey, setSecret } from '../lib/github'
import { getAnthropicKey, setAnthropicKey, hasAnthropicKey } from '../lib/claude'
import nacl from 'tweetnacl'
import sealedbox from 'tweetnacl-sealedbox-js'
import { decodeBase64, encodeBase64, decodeUTF8 } from 'tweetnacl-util'

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

const BASE_SECRET_DEFS = [
  { name: 'ANTHROPIC_API_KEY', label: 'Claude API 密钥', desc: '用于调用 Claude API 生成新闻摘要', type: 'password' },
  { name: 'DEEPSEEK_API_KEY', label: 'DeepSeek API 密钥', desc: '用于调用 DeepSeek V3 作为主力模型（推荐）', type: 'password' },
  { name: 'SMTP_USERNAME', label: '发件邮箱地址', desc: 'SMTP 发件人邮箱', type: 'text' },
  { name: 'SMTP_PASSWORD', label: '邮箱授权码', desc: 'SMTP 邮箱授权码或应用密码', type: 'password' },
  { name: 'EMAIL_RECIPIENTS', label: '收件人邮箱', desc: '邮件收件人，多个邮箱用英文逗号分隔', type: 'text' },
  { name: 'ADMIN_EMAIL', label: '管理员通知邮箱', desc: '接收系统通知的管理员邮箱', type: 'text' },
  { name: 'WEBHOOK_KEYS', label: 'Webhook Keys (JSON)', desc: 'JSON 格式的 webhook key 映射，如 {"default":"key1","ch_ml97ypb3":"key2"}', type: 'password' },
]

const SLOT_SECRETS = [...Array(20)].map((_, i) => ({
  name: `WEBHOOK_KEY_${i + 1}`,
  label: `Webhook 槽位 ${i + 1}`,
  desc: `旧版槽位 key (向后兼容)`,
  type: 'password',
  slot: i + 1,
}))

function encryptSecret(publicKey, secretValue) {
  const keyBytes = decodeBase64(publicKey)
  const messageBytes = decodeUTF8(secretValue)
  const encrypted = sealedbox.seal(messageBytes, keyBytes)
  return encodeBase64(encrypted)
}

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [sha, setSha] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [apiKey, setApiKeyState] = useState(() => getAnthropicKey())
  const [apiKeySaved, setApiKeySaved] = useState(() => hasAnthropicKey())

  // Secrets state
  const [existingSecrets, setExistingSecrets] = useState(new Set())
  const [secretValues, setSecretValues] = useState({})
  const [secretUpdating, setSecretUpdating] = useState({})
  const [secretMessages, setSecretMessages] = useState({})
  const [usedSlots, setUsedSlots] = useState(new Set())
  const [channelSlotMap, setChannelSlotMap] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const file = await readFile('config/settings.json')
      if (file) {
        const parsed = JSON.parse(file.content)
        setSettings(parsed)
        setSha(file.sha)

        const channels = parsed.channels || []
        const webhookChannels = channels.filter(ch => ch.type === 'webhook')
        const slots = new Set()
        const slotMap = {}
        webhookChannels.forEach(ch => {
          if (ch.webhook_key_slot) {
            slots.add(ch.webhook_key_slot)
            slotMap[ch.webhook_key_slot] = ch.name || ch.id
          }
        })
        setUsedSlots(slots)
        setChannelSlotMap(slotMap)
      }

      try {
        const secrets = await listSecrets()
        setExistingSecrets(new Set(secrets.map(s => s.name)))
      } catch { /* secrets API may fail */ }
    } catch (e) {
      console.error('Load settings error:', e)
    }
    setLoading(false)
  }

  function update(key, value) {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  async function save() {
    if (!settings) return
    setSaving(true)
    try {
      // Re-read latest settings to avoid overwriting changes from other pages (e.g. Sources)
      const latest = await readFile('config/settings.json')
      let latestSha = sha
      let merged = settings
      if (latest) {
        latestSha = latest.sha
        const latestData = JSON.parse(latest.content)
        // Preserve fields managed by other pages
        merged = { ...latestData, ...settings, rss_feeds: latestData.rss_feeds }
      }
      const content = JSON.stringify(merged, null, 2) + '\n'
      const result = await writeFile('config/settings.json', content, 'Update settings via admin UI', latestSha)
      setSha(result.content.sha)
      alert('设置已保存')
    } catch (e) {
      alert('保存失败: ' + e.message)
    }
    setSaving(false)
  }

  async function handleUpdateSecret(name) {
    const value = secretValues[name]
    if (!value || !value.trim()) return
    setSecretUpdating(prev => ({ ...prev, [name]: true }))
    setSecretMessages(prev => ({ ...prev, [name]: null }))
    try {
      const pk = await getPublicKey()
      const encrypted = encryptSecret(pk.key, value.trim())
      await setSecret(name, encrypted, pk.key_id)
      setExistingSecrets(prev => new Set([...prev, name]))
      setSecretValues(prev => ({ ...prev, [name]: '' }))
      setSecretMessages(prev => ({ ...prev, [name]: { type: 'success', text: '更新成功' } }))
      setTimeout(() => setSecretMessages(prev => ({ ...prev, [name]: null })), 3000)
    } catch (e) {
      setSecretMessages(prev => ({ ...prev, [name]: { type: 'error', text: `更新失败: ${e.message}` } }))
    }
    setSecretUpdating(prev => ({ ...prev, [name]: false }))
  }

  if (loading) return <p style={{ color: 'var(--text2)' }}>加载中...</p>
  if (!settings) return <p style={{ color: 'var(--text2)' }}>无法加载设置</p>

  const maxUsedSlot = usedSlots.size > 0 ? Math.max(...usedSlots) : 0
  const slotsToShow = Math.max(maxUsedSlot + 3, 5)
  const visibleSlotSecrets = SLOT_SECRETS.slice(0, Math.min(slotsToShow, 20))

  const renderSecretCard = (def) => {
    const isSet = existingSecrets.has(def.name)
    const msg = secretMessages[def.name]
    const isUsedSlot = def.slot && usedSlots.has(def.slot)
    const channelName = def.slot && channelSlotMap[def.slot]

    return (
      <div key={def.name} style={{
        padding: 16, borderRadius: 8, border: `${isUsedSlot ? 2 : 1}px solid ${isUsedSlot ? '#22c55e' : 'var(--border)'}`,
        background: 'var(--card)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6, flexWrap: 'wrap' }}>
          <code style={{ fontSize: 13, fontWeight: 600 }}>{def.name}</code>
          <span style={{
            padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 500,
            background: isSet ? '#d1fae5' : '#fef2f2',
            color: isSet ? '#059669' : '#dc2626',
          }}>
            {isSet ? '已设置' : '未设置'}
          </span>
          {isUsedSlot && (
            <span style={{ padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 500, background: '#dbeafe', color: '#1d4ed8' }}>
              被「{channelName}」使用
            </span>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>{def.desc}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type={def.type}
            value={secretValues[def.name] || ''}
            onChange={e => setSecretValues(prev => ({ ...prev, [def.name]: e.target.value }))}
            placeholder={isSet ? '输入新值以覆盖更新' : '输入值'}
            style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 13 }}
            onKeyDown={e => { if (e.key === 'Enter') handleUpdateSecret(def.name) }}
          />
          <button
            onClick={() => handleUpdateSecret(def.name)}
            disabled={secretUpdating[def.name] || !secretValues[def.name]?.trim()}
            style={{
              padding: '6px 16px', borderRadius: 6, border: 'none',
              background: '#2563eb', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer',
              opacity: (secretUpdating[def.name] || !secretValues[def.name]?.trim()) ? 0.5 : 1,
            }}
          >
            {secretUpdating[def.name] ? '更新中...' : '更新'}
          </button>
        </div>
        {msg && <div style={{ marginTop: 6, fontSize: 12, color: msg.type === 'success' ? '#059669' : '#dc2626' }}>{msg.text}</div>}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, flex: 1 }}>设置</h1>
        <button onClick={save} disabled={saving} style={{ padding: '8px 24px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 500 }}>
          {saving ? '保存中...' : '保存设置'}
        </button>
      </div>

      {/* Basic settings */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>基本设置</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <label>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>时区</span>
            <select value={settings.timezone} onChange={e => update('timezone', e.target.value)} style={{ width: '100%' }}>
              {TIMEZONE_OPTIONS.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
              {!TIMEZONE_OPTIONS.some(tz => tz.value === settings.timezone) && (
                <option value={settings.timezone}>{settings.timezone}</option>
              )}
            </select>
          </label>
          <div>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>每日抓取时间</span>
            {(() => {
              const chs = (settings.channels || []).filter(c => c.enabled)
              if (!chs.length) return <span style={{ fontSize: 13, color: 'var(--text3)' }}>无启用频道</span>
              const earliest = chs.reduce((min, c) => {
                const t = (c.send_hour ?? 10) * 60 + (c.send_minute ?? 0)
                return t < min ? t : min
              }, 24 * 60)
              const fetch = earliest - 30
              const h = Math.floor((fetch + 1440) % 1440 / 60)
              const m = ((fetch + 1440) % 1440) % 60
              return <span style={{ fontSize: 14, fontWeight: 600 }}>{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}</span>
            })()}
            <span style={{ display: 'block', fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>自动计算：最早发送时间前 30 分钟</span>
          </div>
          <label>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>全局 Webhook URL Base</span>
            <input type="text" value={settings.webhook_url_base ?? ''} onChange={e => update('webhook_url_base', e.target.value)} placeholder="https://redcity-open.xiaohongshu.com/api/robot/webhook/send" style={{ width: '100%' }} />
          </label>
        </div>
      </div>

      {/* Secrets management */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>密钥管理</h2>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 16 }}>
          管理 GitHub Actions 使用的 Secrets。值为只写，无法读回已设置的内容，只能覆盖更新。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
          {BASE_SECRET_DEFS.map(def => renderSecretCard(def))}
        </div>

        <h3 style={{ fontSize: 14, marginBottom: 12 }}>旧版 Webhook 槽位 Key（向后兼容）</h3>
        <div style={{ padding: 12, marginBottom: 12, borderRadius: 8, background: '#f0fdf4', border: '1px solid #86efac', fontSize: 13, color: '#15803d' }}>
          推荐使用上方的 <code>WEBHOOK_KEYS</code> (JSON) 替代槽位系统。以下为向后兼容保留。
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {visibleSlotSecrets.map(def => renderSecretCard(def))}
        </div>
      </div>

      {/* AI assist */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>AI 辅助设置</h2>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Anthropic API Key</div>
        <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
          设置后可在添加新闻时使用 AI 自动生成摘要。Key 仅存储在浏览器本地。
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="password" value={apiKey} onChange={e => { setApiKeyState(e.target.value); setApiKeySaved(false) }} placeholder="sk-ant-..." style={{ flex: 1 }} />
          <button onClick={() => { setAnthropicKey(apiKey); setApiKeySaved(true) }} style={{ padding: '6px 16px', background: 'var(--primary-light)', color: 'var(--primary)', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>保存</button>
          {apiKey && (
            <button onClick={() => { setApiKeyState(''); setAnthropicKey(''); setApiKeySaved(false) }} style={{ padding: '6px 16px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' }}>清除</button>
          )}
        </div>
        {apiKeySaved && apiKey && <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 6 }}>API Key 已保存</div>}
        {!apiKey && <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>未设置</div>}
      </div>
    </div>
  )
}
