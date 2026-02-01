import React, { useState, useEffect } from 'react'
import { readFile, listFiles, triggerWorkflow, getWorkflowRuns } from '../lib/github'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow)',
}

export default function Dashboard() {
  const [draft, setDraft] = useState(null)
  const [runs, setRuns] = useState([])
  const [recentDrafts, setRecentDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      // Load today's draft
      const today = new Date().toLocaleDateString('sv-SE') // YYYY-MM-DD
      const todayFile = await readFile(`config/drafts/${today}.json`)
      if (todayFile) setDraft(JSON.parse(todayFile.content))

      // Load recent drafts list
      const files = await listFiles('config/drafts')
      const sorted = files
        .filter(f => f.name.endsWith('.json'))
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, 7)
      setRecentDrafts(sorted)

      // Load workflow runs
      try {
        const fetchRuns = await getWorkflowRuns('fetch-news.yml', 5)
        const sendRuns = await getWorkflowRuns('send-email.yml', 5)
        setRuns([
          ...(fetchRuns.workflow_runs || []).map(r => ({ ...r, type: 'fetch' })),
          ...(sendRuns.workflow_runs || []).map(r => ({ ...r, type: 'send' })),
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10))
      } catch { /* workflow may not exist yet */ }
    } catch (e) {
      console.error('Dashboard load error:', e)
    }
    setLoading(false)
  }

  async function trigger(workflow) {
    setTriggering(workflow)
    try {
      await triggerWorkflow(workflow)
      alert('Workflow 已触发')
    } catch (e) {
      alert('触发失败: ' + e.message)
    }
    setTriggering(null)
  }

  const statusBadge = (status) => {
    const map = {
      pending_review: { bg: '#fef3c7', color: '#d97706', label: '待审核' },
      sent: { bg: '#d1fae5', color: '#059669', label: '已发送' },
    }
    const s = map[status] || { bg: '#f3f4f6', color: '#6b7280', label: status || '未知' }
    return <span style={{ background: s.bg, color: s.color, padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>{s.label}</span>
  }

  const runStatusBadge = (status, conclusion) => {
    if (status === 'completed') {
      if (conclusion === 'success') return <span style={{ color: 'var(--success)', fontSize: 12 }}>成功</span>
      return <span style={{ color: 'var(--danger)', fontSize: 12 }}>{conclusion}</span>
    }
    return <span style={{ color: 'var(--warn)', fontSize: 12 }}>{status}</span>
  }

  if (loading) return <p style={{ color: 'var(--text2)' }}>加载中...</p>

  const totalNews = draft ? (draft.categories || []).reduce((n, c) => n + (c.news || []).length, 0) : 0

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>仪表盘</h1>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={card}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>今日新闻</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{totalNews}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>今日状态</div>
          <div style={{ marginTop: 8 }}>{draft ? statusBadge(draft.status) : <span style={{ color: 'var(--text3)' }}>无草稿</span>}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>近 7 天</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{recentDrafts.length}</div>
        </div>
      </div>

      {/* Quick actions */}
      <div style={{ ...card, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>快捷操作</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={() => trigger('fetch-news.yml')}
            disabled={!!triggering}
            style={{ padding: '8px 20px', background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 500 }}
          >
            {triggering === 'fetch-news.yml' ? '触发中...' : '手动抓取新闻'}
          </button>
          <button
            onClick={() => trigger('send-email.yml')}
            disabled={!!triggering}
            style={{ padding: '8px 20px', background: 'var(--success)', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 500 }}
          >
            {triggering === 'send-email.yml' ? '触发中...' : '立即发送邮件'}
          </button>
        </div>
      </div>

      {/* Recent runs */}
      <div style={{ ...card }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>最近运行记录</h2>
        {runs.length === 0 ? (
          <p style={{ color: 'var(--text3)', fontSize: 14 }}>暂无运行记录</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--text2)', fontWeight: 500 }}>类型</th>
                <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--text2)', fontWeight: 500 }}>状态</th>
                <th style={{ textAlign: 'left', padding: '8px 4px', color: 'var(--text2)', fontWeight: 500 }}>时间</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 4px' }}>
                    <span style={{ background: r.type === 'fetch' ? '#dbeafe' : '#d1fae5', padding: '2px 8px', borderRadius: 4, fontSize: 11 }}>
                      {r.type === 'fetch' ? '抓取' : '发送'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 4px' }}>{runStatusBadge(r.status, r.conclusion)}</td>
                  <td style={{ padding: '8px 4px', color: 'var(--text2)' }}>
                    {new Date(r.created_at).toLocaleString('zh-CN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
