import React, { useState, useEffect } from 'react'
import { readFile, writeFile, triggerWorkflow } from '../lib/github'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow)',
}

const CATEGORY_ICONS = {
  '产品发布': '🚀', '巨头动向': '🏢', '技术进展': '🔬',
  '行业观察': '📊', '投融资': '💰',
}

export default function Review() {
  const [draft, setDraft] = useState(null)
  const [sha, setSha] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [date, setDate] = useState(new Date().toLocaleDateString('sv-SE'))

  useEffect(() => { loadDraft() }, [date])

  async function loadDraft() {
    setLoading(true)
    try {
      const file = await readFile(`config/drafts/${date}.json`)
      if (file) {
        setDraft(JSON.parse(file.content))
        setSha(file.sha)
      } else {
        setDraft(null)
        setSha(null)
      }
    } catch (e) {
      console.error('Load draft error:', e)
      setDraft(null)
    }
    setLoading(false)
  }

  async function saveDraft() {
    if (!draft) return
    setSaving(true)
    try {
      const content = JSON.stringify(draft, null, 2)
      const result = await writeFile(
        `config/drafts/${date}.json`,
        content,
        `Update draft for ${date}`,
        sha
      )
      setSha(result.content.sha)
      alert('已保存')
    } catch (e) {
      alert('保存失败: ' + e.message)
    }
    setSaving(false)
  }

  async function sendNow() {
    if (!draft) return
    setSending(true)
    try {
      // Save as approved first
      draft.status = 'approved'
      const content = JSON.stringify(draft, null, 2)
      const result = await writeFile(
        `config/drafts/${date}.json`,
        content,
        `Approve draft for ${date}`,
        sha
      )
      setSha(result.content.sha)

      // Trigger send workflow
      await triggerWorkflow('send-email.yml', 'main', { date })
      alert('发送已触发')
    } catch (e) {
      alert('发送失败: ' + e.message)
    }
    setSending(false)
  }

  function removeNews(catIdx, newsIdx) {
    const updated = { ...draft }
    updated.categories = [...updated.categories]
    updated.categories[catIdx] = { ...updated.categories[catIdx] }
    updated.categories[catIdx].news = updated.categories[catIdx].news.filter((_, i) => i !== newsIdx)
    // Remove empty categories
    updated.categories = updated.categories.filter(c => c.news && c.news.length > 0)
    setDraft(updated)
  }

  function updateSummary(catIdx, newsIdx, value) {
    const updated = { ...draft }
    updated.categories = [...updated.categories]
    updated.categories[catIdx] = { ...updated.categories[catIdx] }
    updated.categories[catIdx].news = [...updated.categories[catIdx].news]
    updated.categories[catIdx].news[newsIdx] = { ...updated.categories[catIdx].news[newsIdx], summary: value }
    setDraft(updated)
  }

  function moveToTop(catIdx, newsIdx) {
    if (newsIdx === 0) return
    const updated = { ...draft }
    updated.categories = [...updated.categories]
    updated.categories[catIdx] = { ...updated.categories[catIdx] }
    const news = [...updated.categories[catIdx].news]
    const [item] = news.splice(newsIdx, 1)
    news.unshift(item)
    updated.categories[catIdx].news = news
    setDraft(updated)
  }

  if (loading) return <p style={{ color: 'var(--text2)' }}>加载中...</p>

  const totalNews = draft ? (draft.categories || []).reduce((n, c) => n + (c.news || []).length, 0) : 0
  const isSent = draft?.status === 'sent'

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, flex: 1 }}>新闻审核</h1>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ padding: '6px 12px' }}
        />
      </div>

      {!draft ? (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text2)' }}>
          <p style={{ fontSize: 16 }}>暂无 {date} 的新闻草稿</p>
          <p style={{ fontSize: 13, marginTop: 8 }}>请先触发新闻抓取</p>
        </div>
      ) : (
        <>
          {/* Status bar */}
          <div style={{ ...card, display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <div style={{ flex: 1 }}>
              <span style={{ fontSize: 14, color: 'var(--text2)' }}>
                {date} | {totalNews} 条新闻 | 时间窗口: {draft.time_window}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={saveDraft}
                disabled={saving || isSent}
                style={{ padding: '6px 16px', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontWeight: 500 }}
              >
                {saving ? '保存中...' : '保存修改'}
              </button>
              <button
                onClick={sendNow}
                disabled={sending || isSent}
                style={{ padding: '6px 16px', background: isSent ? 'var(--text3)' : 'var(--success)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 500 }}
              >
                {isSent ? '已发送' : sending ? '发送中...' : '确认发送'}
              </button>
            </div>
          </div>

          {/* News list by category */}
          {(draft.categories || []).map((cat, catIdx) => (
            <div key={catIdx} style={{ ...card, marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>
                {CATEGORY_ICONS[cat.name] || cat.icon || '📰'} {cat.name}
                <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>({(cat.news || []).length})</span>
              </h2>

              {(cat.news || []).map((item, newsIdx) => (
                <div key={newsIdx} style={{
                  padding: '12px 16px', borderRadius: 8,
                  border: '1px solid var(--border)', marginBottom: 8,
                  background: '#fafafa',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <a href={item.url} target="_blank" rel="noopener" style={{ fontWeight: 600, fontSize: 14 }}>
                        {item.title}
                      </a>
                      <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{item.source}</div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        onClick={() => moveToTop(catIdx, newsIdx)}
                        disabled={isSent}
                        title="置顶"
                        style={{ padding: '2px 6px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}
                      >
                        ⬆
                      </button>
                      <button
                        onClick={() => removeNews(catIdx, newsIdx)}
                        disabled={isSent}
                        title="删除"
                        style={{ padding: '2px 6px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, color: 'var(--danger)', cursor: 'pointer' }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={item.summary || ''}
                    onChange={(e) => updateSummary(catIdx, newsIdx, e.target.value)}
                    disabled={isSent}
                    style={{
                      width: '100%', marginTop: 8, padding: '6px 10px',
                      border: '1px solid var(--border)', borderRadius: 4,
                      fontSize: 13, resize: 'vertical', minHeight: 40,
                      background: isSent ? '#f9fafb' : '#fff',
                    }}
                  />
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
