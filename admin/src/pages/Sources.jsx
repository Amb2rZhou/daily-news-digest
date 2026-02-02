import React, { useState, useEffect } from 'react'
import { readFile, writeFile } from '../lib/github'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow)',
  marginBottom: 20,
}

export default function Sources() {
  const [settings, setSettings] = useState(null)
  const [sha, setSha] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [collapsed, setCollapsed] = useState({})

  // New source form
  const [newUrl, setNewUrl] = useState('')
  const [newName, setNewName] = useState('')
  const [newGroup, setNewGroup] = useState('')

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
      const result = await writeFile('config/settings.json', content, 'Update RSS feeds via admin UI', sha)
      setSha(result.content.sha)
      setSettings(updatedSettings)
      alert('已保存')
    } catch (e) {
      alert('保存失败: ' + e.message)
    }
    setSaving(false)
  }

  function toggleFeed(idx) {
    const updated = { ...settings }
    updated.rss_feeds = [...updated.rss_feeds]
    updated.rss_feeds[idx] = { ...updated.rss_feeds[idx], enabled: !updated.rss_feeds[idx].enabled }
    setSettings(updated)
  }

  function deleteFeed(idx) {
    if (!confirm('确认删除此源?')) return
    const updated = { ...settings }
    updated.rss_feeds = updated.rss_feeds.filter((_, i) => i !== idx)
    setSettings(updated)
  }

  function addFeed() {
    if (!newUrl.trim() || !newName.trim()) return
    const updated = { ...settings }
    updated.rss_feeds = [...(updated.rss_feeds || []), {
      url: newUrl.trim(),
      name: newName.trim(),
      group: newGroup.trim() || '未分组',
      enabled: true,
    }]
    setSettings(updated)
    setNewUrl('')
    setNewName('')
    setNewGroup('')
  }

  function toggleGroup(group, enable) {
    const updated = { ...settings }
    updated.rss_feeds = updated.rss_feeds.map(f =>
      f.group === group ? { ...f, enabled: enable } : f
    )
    setSettings(updated)
  }

  function toggleCollapse(group) {
    setCollapsed(prev => ({ ...prev, [group]: !prev[group] }))
  }

  if (loading) return <p style={{ color: 'var(--text2)' }}>加载中...</p>
  if (!settings) return <p style={{ color: 'var(--text2)' }}>无法加载设置</p>

  const feeds = settings.rss_feeds || []
  const groups = {}
  feeds.forEach((f, idx) => {
    const g = f.group || '未分组'
    if (!groups[g]) groups[g] = []
    groups[g].push({ ...f, _idx: idx })
  })
  const enabledCount = feeds.filter(f => f.enabled).length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, flex: 1 }}>
          新闻源管理
          <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text2)', marginLeft: 12 }}>
            {enabledCount}/{feeds.length} 启用
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

      {/* Add new source */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>添加新源</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
          <label>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>URL</span>
            <input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="https://example.com/feed"
              style={{ width: '100%' }}
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>名称</span>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="源名称"
              style={{ width: '100%' }}
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>分组</span>
            <input
              type="text"
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="分组名"
              style={{ width: '100%' }}
              list="group-suggestions"
            />
            <datalist id="group-suggestions">
              {Object.keys(groups).map(g => <option key={g} value={g} />)}
            </datalist>
          </label>
          <button
            onClick={addFeed}
            disabled={!newUrl.trim() || !newName.trim()}
            style={{ padding: '8px 20px', background: 'var(--primary-light)', color: 'var(--primary)', border: 'none', borderRadius: 6, fontWeight: 500, height: 38 }}
          >
            添加
          </button>
        </div>
      </div>

      {/* Feed list by group */}
      {Object.entries(groups).map(([group, groupFeeds]) => {
        const groupEnabled = groupFeeds.filter(f => f.enabled).length
        const isCollapsed = collapsed[group]
        return (
          <div key={group} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: isCollapsed ? 0 : 12 }}>
              <button
                onClick={() => toggleCollapse(group)}
                style={{ background: 'none', border: 'none', fontSize: 14, padding: '2px 4px', color: 'var(--text2)' }}
              >
                {isCollapsed ? '▶' : '▼'}
              </button>
              <h2 style={{ fontSize: 15, flex: 1, margin: 0 }}>
                {group}
                <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>
                  ({groupEnabled}/{groupFeeds.length})
                </span>
              </h2>
              {group === 'WeWe RSS' && (
                <a
                  href="https://amb2rzhou.zeabur.app/dash/feeds"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ padding: '4px 10px', background: '#dbeafe', color: '#2563eb', border: 'none', borderRadius: 4, fontSize: 12, textDecoration: 'none' }}
                >
                  管理公众号源
                </a>
              )}
              <button
                onClick={() => toggleGroup(group, true)}
                style={{ padding: '4px 10px', background: '#d1fae5', color: '#059669', border: 'none', borderRadius: 4, fontSize: 12 }}
              >
                全部启用
              </button>
              <button
                onClick={() => toggleGroup(group, false)}
                style={{ padding: '4px 10px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 4, fontSize: 12 }}
              >
                全部禁用
              </button>
            </div>
            {!isCollapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {groupFeeds.map(feed => (
                  <div key={feed._idx} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 12px', background: feed.enabled ? '#f9fafb' : '#fef2f2',
                    borderRadius: 6, border: '1px solid var(--border)',
                    opacity: feed.enabled ? 1 : 0.7,
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={feed.enabled}
                        onChange={() => toggleFeed(feed._idx)}
                        style={{ marginRight: 8 }}
                      />
                    </label>
                    <span style={{ fontWeight: 500, fontSize: 14, minWidth: 120 }}>{feed.name}</span>
                    <span style={{ flex: 1, fontSize: 12, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {feed.url}
                    </span>
                    <button
                      onClick={() => deleteFeed(feed._idx)}
                      style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 14, padding: '2px 6px', cursor: 'pointer' }}
                      title="删除"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
