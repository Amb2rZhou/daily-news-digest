import React, { useState, useEffect } from 'react'
import { readFile, writeFile, updateWorkflowCron } from '../lib/github'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow)',
  marginBottom: 20,
}

const CATEGORY_OPTIONS = ['产品发布', '巨头动向', '技术进展', '行业观察', '投融资']

export default function Settings() {
  const [settings, setSettings] = useState(null)
  const [sha, setSha] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Temp fields for list inputs
  const [newBlacklistKw, setNewBlacklistKw] = useState('')
  const [newBlacklistSrc, setNewBlacklistSrc] = useState('')
  const [newWhitelistKw, setNewWhitelistKw] = useState('')
  const [newWhitelistSrc, setNewWhitelistSrc] = useState('')

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

      // Also update workflow cron if send_hour changed
      const utcHour = (settings.send_hour - 8 + 24) % 24 // Asia/Shanghai = UTC+8
      const newCron = `0 ${utcHour} * * *`
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
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>发送时间（北京时间）</span>
            <select
              value={settings.send_hour}
              onChange={(e) => update('send_hour', parseInt(e.target.value))}
              style={{ width: '100%' }}
            >
              {Array.from({ length: 24 }, (_, i) => (
                <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>
              ))}
            </select>
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

          <label>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>新闻主题</span>
            <input
              type="text"
              value={settings.news_topic}
              onChange={(e) => update('news_topic', e.target.value)}
              style={{ width: '100%' }}
            />
          </label>

          <label>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>时区</span>
            <input
              type="text"
              value={settings.timezone}
              onChange={(e) => update('timezone', e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
        </div>
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

        {/* Blacklist keywords */}
        <FilterList
          label="黑名单关键词"
          items={settings.filters?.blacklist_keywords || []}
          value={newBlacklistKw}
          onChange={setNewBlacklistKw}
          onAdd={() => addToList('blacklist_keywords', newBlacklistKw, setNewBlacklistKw)}
          onRemove={(idx) => removeFromList('blacklist_keywords', idx)}
        />

        {/* Blacklist sources */}
        <FilterList
          label="黑名单来源"
          items={settings.filters?.blacklist_sources || []}
          value={newBlacklistSrc}
          onChange={setNewBlacklistSrc}
          onAdd={() => addToList('blacklist_sources', newBlacklistSrc, setNewBlacklistSrc)}
          onRemove={(idx) => removeFromList('blacklist_sources', idx)}
        />

        {/* Whitelist keywords */}
        <FilterList
          label="白名单关键词"
          items={settings.filters?.whitelist_keywords || []}
          value={newWhitelistKw}
          onChange={setNewWhitelistKw}
          onAdd={() => addToList('whitelist_keywords', newWhitelistKw, setNewWhitelistKw)}
          onRemove={(idx) => removeFromList('whitelist_keywords', idx)}
        />

        {/* Whitelist sources */}
        <FilterList
          label="白名单来源"
          items={settings.filters?.whitelist_sources || []}
          value={newWhitelistSrc}
          onChange={setNewWhitelistSrc}
          onAdd={() => addToList('whitelist_sources', newWhitelistSrc, setNewWhitelistSrc)}
          onRemove={(idx) => removeFromList('whitelist_sources', idx)}
        />
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
