import React, { useState, useEffect } from 'react'
import { readFile, writeFile } from '../lib/github'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow)',
  marginBottom: 20,
}

export default function Recipients() {
  const [settings, setSettings] = useState(null)
  const [sha, setSha] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')

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
      console.error('Load error:', e)
    }
    setLoading(false)
  }

  async function save(updatedSettings) {
    setSaving(true)
    try {
      const content = JSON.stringify(updatedSettings, null, 2) + '\n'
      const result = await writeFile('config/settings.json', content, 'Update recipients via admin UI', sha)
      setSha(result.content.sha)
      setSettings(updatedSettings)
      alert('已保存')
    } catch (e) {
      alert('保存失败: ' + e.message)
    }
    setSaving(false)
  }

  function toggleRecipient(idx) {
    const updated = { ...settings }
    updated.recipients = [...updated.recipients]
    updated.recipients[idx] = { ...updated.recipients[idx], enabled: !updated.recipients[idx].enabled }
    setSettings(updated)
  }

  function deleteRecipient(idx) {
    if (!confirm('确认删除此收件人?')) return
    const updated = { ...settings }
    updated.recipients = updated.recipients.filter((_, i) => i !== idx)
    setSettings(updated)
  }

  function addRecipient() {
    if (!newEmail.trim()) return
    const updated = { ...settings }
    updated.recipients = [...(updated.recipients || []), {
      email: newEmail.trim(),
      name: newName.trim() || '',
      enabled: true,
    }]
    setSettings(updated)
    setNewEmail('')
    setNewName('')
  }

  if (loading) return <p style={{ color: 'var(--text2)' }}>加载中...</p>
  if (!settings) return <p style={{ color: 'var(--text2)' }}>无法加载设置</p>

  const recipients = settings.recipients || []
  const enabledCount = recipients.filter(r => r.enabled).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, flex: 1 }}>
          收件人管理
          <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text2)', marginLeft: 12 }}>
            {enabledCount}/{recipients.length} 启用
          </span>
        </h1>
        <button
          onClick={() => save(settings)}
          disabled={saving}
          style={{ padding: '8px 24px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 500 }}
        >
          {saving ? '保存中...' : '保存更改'}
        </button>
      </div>

      {/* Add new recipient */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>添加收件人</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <label style={{ flex: 2 }}>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>邮箱地址</span>
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
              placeholder="user@example.com"
              style={{ width: '100%' }}
            />
          </label>
          <label style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>姓名（可选）</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addRecipient()}
              placeholder="姓名"
              style={{ width: '100%' }}
            />
          </label>
          <button
            onClick={addRecipient}
            disabled={!newEmail.trim()}
            style={{ padding: '8px 20px', background: 'var(--primary-light)', color: 'var(--primary)', border: 'none', borderRadius: 6, fontWeight: 500, height: 38 }}
          >
            添加
          </button>
        </div>
      </div>

      {/* Recipient list */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>收件人列表</h2>
        {recipients.length === 0 ? (
          <p style={{ color: 'var(--text3)', fontSize: 14, textAlign: 'center', padding: 20 }}>暂无收件人，请添加</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {recipients.map((r, idx) => (
              <div key={idx} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', background: r.enabled ? '#f9fafb' : '#fef2f2',
                borderRadius: 6, border: '1px solid var(--border)',
                opacity: r.enabled ? 1 : 0.7,
              }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    onChange={() => toggleRecipient(idx)}
                    style={{ marginRight: 8 }}
                  />
                </label>
                <span style={{ fontWeight: 500, fontSize: 14, minWidth: 80 }}>{r.name || '-'}</span>
                <span style={{ flex: 1, fontSize: 14, color: 'var(--text2)' }}>{r.email}</span>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 12,
                  background: r.enabled ? '#d1fae5' : '#fee2e2',
                  color: r.enabled ? '#059669' : '#dc2626',
                }}>
                  {r.enabled ? '启用' : '禁用'}
                </span>
                <button
                  onClick={() => deleteRecipient(idx)}
                  style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 16, padding: '2px 6px', cursor: 'pointer' }}
                  title="删除"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
