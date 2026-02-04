import React, { useState, useEffect } from 'react'
import { listFiles, readFile } from '../lib/github'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow)',
  marginBottom: 16,
}

const CATEGORY_ICONS = {
  // 聚焦模式
  '智能硬件': '🥽', 'AI技术与产品': '🤖', '巨头动向与行业观察': '🏢',
  // 泛AI模式
  '产品发布': '🚀', '巨头动向': '🏢', '技术进展': '🔬',
  '行业观察': '📊', '投融资': '💰',
}

export default function History() {
  const [drafts, setDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState({})
  const [draftData, setDraftData] = useState({})

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      const files = await listFiles('config/drafts')
      const sorted = files
        .filter(f => f.name.endsWith('.json'))
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, 30)  // 保留最近 30 天
      setDrafts(sorted)

      // Pre-load all draft data for status display
      const dataMap = {}
      await Promise.all(sorted.map(async (f) => {
        try {
          const file = await readFile(`config/drafts/${f.name}`)
          if (file) dataMap[f.name.replace('.json', '')] = JSON.parse(file.content)
        } catch { /* ignore */ }
      }))
      setDraftData(dataMap)
    } catch (e) {
      console.error('Load drafts error:', e)
    }
    setLoading(false)
  }

  async function toggleExpand(name) {
    const date = name.replace('.json', '')
    if (expanded[date]) {
      setExpanded(prev => ({ ...prev, [date]: false }))
      return
    }
    // Load draft data if not cached
    if (!draftData[date]) {
      try {
        const file = await readFile(`config/drafts/${name}`)
        if (file) {
          setDraftData(prev => ({ ...prev, [date]: JSON.parse(file.content) }))
        }
      } catch (e) {
        console.error('Load draft error:', e)
      }
    }
    setExpanded(prev => ({ ...prev, [date]: true }))
  }

  const statusBadge = (status) => {
    const map = {
      pending_review: { bg: '#fef3c7', color: '#d97706', label: '待审核' },
      approved: { bg: '#dbeafe', color: '#2563eb', label: '已审核' },
      sent: { bg: '#d1fae5', color: '#059669', label: '已发送' },
      rejected: { bg: '#fee2e2', color: '#dc2626', label: '已拒绝' },
    }
    const s = map[status] || { bg: '#f3f4f6', color: '#6b7280', label: status || '未知' }
    return <span style={{ background: s.bg, color: s.color, padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>{s.label}</span>
  }

  if (loading) return <p style={{ color: 'var(--text2)' }}>加载中...</p>

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>发送历史</h1>

      {drafts.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text2)' }}>
          <p style={{ fontSize: 16 }}>暂无发送记录</p>
        </div>
      ) : (
        drafts.map(f => {
          const date = f.name.replace('.json', '')
          const isExpanded = expanded[date]
          const data = draftData[date]
          const totalNews = data ? (data.categories || []).reduce((n, c) => n + (c.news || []).length, 0) : null

          return (
            <div key={f.name} style={card}>
              <div
                onClick={() => toggleExpand(f.name)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
              >
                <span style={{ fontSize: 14, color: 'var(--text2)' }}>{isExpanded ? '▼' : '▶'}</span>
                <span style={{ fontWeight: 600, fontSize: 15 }}>{date}</span>
                {data && (
                  <>
                    {statusBadge(data.status)}
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>{totalNews} 条新闻</span>
                    {data.time_window && <span style={{ fontSize: 12, color: 'var(--text3)' }}>{data.time_window}</span>}
                  </>
                )}
              </div>

              {isExpanded && data && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                  {(data.categories || []).map((cat, catIdx) => (
                    <div key={catIdx} style={{ marginBottom: 16 }}>
                      <h3 style={{ fontSize: 14, marginBottom: 8 }}>
                        {CATEGORY_ICONS[cat.name] || '📰'} {cat.name}
                        <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400, marginLeft: 6 }}>({(cat.news || []).length})</span>
                      </h3>
                      {(cat.news || []).map((item, newsIdx) => (
                        <div key={newsIdx} style={{
                          padding: '10px 14px', marginBottom: 6, borderRadius: 6,
                          border: '1px solid var(--border)', background: '#fafafa',
                        }}>
                          <a href={item.url} target="_blank" rel="noopener" style={{ fontWeight: 500, fontSize: 13 }}>
                            {item.title}
                          </a>
                          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{item.source}</div>
                          {item.summary && (
                            <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 6, lineHeight: 1.5 }}>{item.summary}</p>
                          )}
                          {item.comment && (
                            <p style={{ fontSize: 12, color: '#7c3aed', marginTop: 4, fontStyle: 'italic' }}>{item.comment}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })
      )}
    </div>
  )
}
