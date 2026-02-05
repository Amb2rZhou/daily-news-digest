import React, { useState, useEffect } from 'react'
import { listSecrets, getPublicKey, setSecret, readFile } from '../lib/github'
import nacl from 'tweetnacl'
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
  { name: 'WEBHOOK_KEYS', label: 'Webhook 密钥 (JSON)', desc: '所有 Webhook 频道的密钥，JSON 格式：{"频道ID": "key值", ...}', type: 'password' },
]

function encryptSecret(publicKey, secretValue) {
  const keyBytes = decodeBase64(publicKey)
  const messageBytes = decodeUTF8(secretValue)
  const encrypted = nacl.box.seal(messageBytes, keyBytes)
  return encodeBase64(encrypted)
}

export default function Secrets() {
  const [existingSecrets, setExistingSecrets] = useState(new Set())
  const [loading, setLoading] = useState(true)
  const [values, setValues] = useState({})
  const [updating, setUpdating] = useState({})
  const [messages, setMessages] = useState({})
  const [webhookChannelIds, setWebhookChannelIds] = useState([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const secrets = await listSecrets()
      setExistingSecrets(new Set(secrets.map(s => s.name)))

      // Load settings to get webhook channel ids for helper text
      try {
        const settingsFile = await readFile('config/settings.json')
        if (settingsFile) {
          const settings = JSON.parse(settingsFile.content)
          const channels = settings.channels || []
          const webhookIds = channels
            .filter(ch => ch.type === 'webhook')
            .map(ch => ch.id)
          setWebhookChannelIds(webhookIds)
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

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>密钥管理</h1>
      <p style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 24 }}>
        管理 GitHub Actions 使用的 Secrets。值为只写，无法读回已设置的内容，只能覆盖更新。
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {BASE_SECRET_DEFS.map(def => {
          const isSet = existingSecrets.has(def.name)
          const msg = messages[def.name]
          const isWebhookKeys = def.name === 'WEBHOOK_KEYS'
          return (
            <div key={def.name} style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <code style={{ fontSize: 14, fontWeight: 600 }}>{def.name}</code>
                <span style={{
                  padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500,
                  background: isSet ? '#d1fae5' : '#fef2f2',
                  color: isSet ? '#059669' : '#dc2626',
                }}>
                  {isSet ? '已设置' : '未设置'}
                </span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>{def.desc}</div>

              {/* WEBHOOK_KEYS helper */}
              {isWebhookKeys && webhookChannelIds.length > 0 && (
                <div style={{
                  padding: 12, marginBottom: 12, borderRadius: 6,
                  background: '#f0f9ff', border: '1px solid #bae6fd',
                  fontSize: 12, color: '#0369a1',
                }}>
                  <strong>当前 Webhook 频道 ID：</strong>
                  <span style={{ fontFamily: 'monospace' }}>
                    {webhookChannelIds.join(', ')}
                  </span>
                  <div style={{ marginTop: 6, color: '#64748b' }}>
                    格式示例：{`{"${webhookChannelIds[0]}": "your_key_here"${webhookChannelIds.length > 1 ? `, "${webhookChannelIds[1]}": "another_key"` : ''}}`}
                  </div>
                </div>
              )}

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
        })}
      </div>
    </div>
  )
}
