import React, { useState, useEffect } from 'react'
import { listSecrets, getPublicKey, setSecret, readFile } from '../lib/github'
import nacl from 'tweetnacl'
import sealedbox from 'tweetnacl-sealedbox-js'
import { decodeBase64, encodeBase64, decodeUTF8 } from 'tweetnacl-util'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow)',
}

const BASE_SECRET_DEFS = [
  { name: 'ANTHROPIC_API_KEY', label: 'Claude API 密钥', desc: '用于调用 Claude API 生成新闻摘要', type: 'password' },
  { name: 'SMTP_USERNAME', label: '发件邮箱地址', desc: 'SMTP 发件人邮箱', type: 'text' },
  { name: 'SMTP_PASSWORD', label: '邮箱授权码', desc: 'SMTP 邮箱授权码或应用密码', type: 'password' },
  { name: 'EMAIL_RECIPIENTS', label: '收件人邮箱', desc: '邮件收件人，多个邮箱用英文逗号分隔', type: 'text' },
  { name: 'ADMIN_EMAIL', label: '管理员通知邮箱', desc: '接收系统通知的管理员邮箱', type: 'text' },
]

const LEGACY_WEBHOOK_SECRET = { name: 'WEBHOOK_KEYS', label: 'Webhook 密钥 (旧方式)', desc: 'JSON 格式：{"频道ID": "key值", ...}。如果频道配置了槽位，则使用新方式。', type: 'password' }

// Generate slot-based secrets
const SLOT_SECRETS = [...Array(20)].map((_, i) => ({
  name: `WEBHOOK_KEY_${i + 1}`,
  label: `Webhook 槽位 ${i + 1}`,
  desc: `在频道设置中选择"槽位 ${i + 1}"即可使用此 key`,
  type: 'password',
  slot: i + 1,
}))

function encryptSecret(publicKey, secretValue) {
  const keyBytes = decodeBase64(publicKey)
  const messageBytes = decodeUTF8(secretValue)
  const encrypted = sealedbox.seal(messageBytes, keyBytes)
  return encodeBase64(encrypted)
}

export default function Secrets() {
  const [existingSecrets, setExistingSecrets] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [values, setValues] = useState({})
  const [updating, setUpdating] = useState({})
  const [messages, setMessages] = useState({})
  const [webhookChannelIds, setWebhookChannelIds] = useState([])
  const [usedSlots, setUsedSlots] = useState(new Set())
  const [channelSlotMap, setChannelSlotMap] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const secrets = await listSecrets()
      setExistingSecrets(new Set(secrets.map(s => s.name)))

      // Load settings to get webhook channel info
      try {
        const settingsFile = await readFile('config/settings.json')
        if (settingsFile) {
          const settings = JSON.parse(settingsFile.content)
          const channels = settings.channels || []
          const webhookChannels = channels.filter(ch => ch.type === 'webhook')
          setWebhookChannelIds(webhookChannels.map(ch => ch.id))

          // Track which slots are in use
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
      } catch {
        // Settings load failed
      }
    } catch (e) {
      console.error('Load secrets error:', e)
    }
    setLoading(false)
  }

  async function handleUpdate(name) {
    const value = values[name]
    if (!value || !value.trim()) return

    setUpdating(prev => ({ ...prev, [name]: true }))
    setMessages(prev => ({ ...prev, [name]: null }))
    try {
      const pk = await getPublicKey()
      const encrypted = encryptSecret(pk.key, value.trim())
      await setSecret(name, encrypted, pk.key_id)
      setExistingSecrets(prev => new Set([...prev, name]))
      setValues(prev => ({ ...prev, [name]: '' }))
      setMessages(prev => ({ ...prev, [name]: { type: 'success', text: '更新成功' } }))
      setTimeout(() => setMessages(prev => ({ ...prev, [name]: null })), 3000)
    } catch (e) {
      console.error('Update secret error:', e)
      setMessages(prev => ({ ...prev, [name]: { type: 'error', text: `更新失败: ${e.message}` } }))
    }
    setUpdating(prev => ({ ...prev, [name]: false }))
  }

  if (loading) return <p style={{ color: 'var(--text2)' }}>加载中...</p>

  // Determine which slot secrets to show: used ones + a few extra
  const maxUsedSlot = usedSlots.size > 0 ? Math.max(...usedSlots) : 0
  const slotsToShow = Math.max(maxUsedSlot + 3, 5) // Show at least 5, or used + 3
  const visibleSlotSecrets = SLOT_SECRETS.slice(0, Math.min(slotsToShow, 20))

  const renderSecretCard = (def, extraContent = null) => {
    const isSet = existingSecrets.has(def.name)
    const msg = messages[def.name]
    const isUsedSlot = def.slot && usedSlots.has(def.slot)
    const channelName = def.slot && channelSlotMap[def.slot]

    return (
      <div key={def.name} style={{
        ...card,
        borderColor: isUsedSlot ? '#22c55e' : 'var(--border)',
        borderWidth: isUsedSlot ? 2 : 1,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <code style={{ fontSize: 14, fontWeight: 600 }}>{def.name}</code>
          <span style={{
            padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500,
            background: isSet ? '#d1fae5' : '#fef2f2',
            color: isSet ? '#059669' : '#dc2626',
          }}>
            {isSet ? '已设置' : '未设置'}
          </span>
          {isUsedSlot && (
            <span style={{
              padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500,
              background: '#dbeafe', color: '#1d4ed8',
            }}>
              被「{channelName}」使用中
            </span>
          )}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{def.desc}</div>
        {extraContent}
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type={def.type}
            value={values[def.name] || ''}
            onChange={e => setValues(prev => ({ ...prev, [def.name]: e.target.value }))}
            placeholder={isSet ? '输入新值以覆盖更新' : '输入值'}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 6,
              border: '1px solid var(--border)', fontSize: 14,
              background: 'var(--bg)', color: 'var(--text)',
            }}
            onKeyDown={e => { if (e.key === 'Enter') handleUpdate(def.name) }}
          />
          <button
            onClick={() => handleUpdate(def.name)}
            disabled={updating[def.name] || !values[def.name]?.trim()}
            style={{
              padding: '8px 20px', borderRadius: 6, border: 'none',
              background: '#2563eb', color: '#fff', fontWeight: 600,
              fontSize: 14, cursor: 'pointer',
              opacity: (updating[def.name] || !values[def.name]?.trim()) ? 0.5 : 1,
            }}
          >
            {updating[def.name] ? '更新中...' : '更新'}
          </button>
        </div>
        {msg && (
          <div style={{
            marginTop: 8, fontSize: 13,
            color: msg.type === 'success' ? '#059669' : '#dc2626',
          }}>
            {msg.text}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>密钥管理</h1>
      <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 24 }}>
        管理 GitHub Actions 使用的 Secrets。值为只写，无法读回已设置的内容，只能覆盖更新。
      </p>

      {/* Base secrets */}
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>基础配置</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
        {BASE_SECRET_DEFS.map(def => renderSecretCard(def))}
      </div>

      {/* Webhook keys section */}
      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Webhook 密钥</h2>

      <div style={{
        padding: 16, marginBottom: 16, borderRadius: 8,
        background: '#f0fdf4', border: '1px solid #86efac',
        fontSize: 13,
      }}>
        <strong style={{ color: '#166534' }}>推荐：使用槽位方式（新）</strong>
        <div style={{ marginTop: 8, color: '#15803d' }}>
          1. 在「设置」页面为频道选择一个槽位（如槽位 1）<br />
          2. 在这里设置对应的 WEBHOOK_KEY_1<br />
          3. 添加新频道时只需设置新的槽位，不影响已有频道
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 24 }}>
        {visibleSlotSecrets.map(def => renderSecretCard(def))}
      </div>

      {/* Legacy webhook keys */}
      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontSize: 14, color: 'var(--text2)', marginBottom: 12 }}>
          旧方式：WEBHOOK_KEYS JSON（点击展开）
        </summary>
        <div style={{ marginTop: 12 }}>
          {renderSecretCard(LEGACY_WEBHOOK_SECRET, webhookChannelIds.length > 0 && (
            <div style={{
              padding: 12, marginBottom: 12, borderRadius: 6,
              background: '#fefce8', border: '1px solid #fde047',
              fontSize: 12, color: '#854d0e',
            }}>
              <strong>当前 Webhook 频道 ID：</strong>
              <span style={{ fontFamily: 'monospace' }}>
                {webhookChannelIds.join(', ')}
              </span>
              <div style={{ marginTop: 6, color: '#a16207' }}>
                格式示例：{`{"${webhookChannelIds[0] || 'channel_id'}": "your_key_here"}`}
              </div>
              <div style={{ marginTop: 6, color: '#a16207' }}>
                注意：如果频道配置了槽位，则优先使用槽位方式，忽略此 JSON 中的值。
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  )
}
