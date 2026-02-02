import React, { useState, useEffect } from 'react'
import { readFile, listFiles, getWorkflowRuns } from '../lib/github'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow)',
}

const WEWE_RSS_BASE = 'https://amb2rzhou.zeabur.app'

export default function Dashboard() {
  const [settings, setSettings] = useState(null)
  const [runs, setRuns] = useState([])
  const [recentDrafts, setRecentDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [weweStatus, setWeweStatus] = useState(null) // { ok, lastSync, feedCount }

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    try {
      // Load settings
      const settingsFile = await readFile('config/settings.json')
      if (settingsFile) setSettings(JSON.parse(settingsFile.content))

      // Load recent drafts list
      try {
        const files = await listFiles('config/drafts')
        const sorted = files
          .filter(f => f.name.endsWith('.json'))
          .sort((a, b) => b.name.localeCompare(a.name))
          .slice(0, 7)
        setRecentDrafts(sorted)
      } catch { /* drafts dir may not exist */ }

      // Check WeWe RSS login status
      try {
        const res = await fetch(`${WEWE_RSS_BASE}/feeds`)
        if (res.ok) {
          const feeds = await res.json()
          if (feeds.length > 0) {
            const latestSync = Math.max(...feeds.map(f => f.syncTime || 0))
            const hoursSince = (Date.now() / 1000 - latestSync) / 3600
            setWeweStatus({
              ok: hoursSince < 12,
              lastSync: latestSync > 0 ? new Date(latestSync * 1000) : null,
              feedCount: feeds.length,
              hoursSince: Math.round(hoursSince),
            })
          }
        }
      } catch { /* WeWe RSS may be unreachable */ }

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

  const runStatusBadge = (status, conclusion) => {
    if (status === 'completed') {
      if (conclusion === 'success') return <span style={{ color: 'var(--success)', fontSize: 12 }}>成功</span>
      return <span style={{ color: 'var(--danger)', fontSize: 12 }}>{conclusion}</span>
    }
    return <span style={{ color: 'var(--warn)', fontSize: 12 }}>{status}</span>
  }

  if (loading) return <p style={{ color: 'var(--text2)' }}>加载中...</p>

  const feeds = settings?.rss_feeds || []
  const enabledFeeds = feeds.filter(f => f.enabled)
  const recipients = settings?.recipients || []
  const enabledRecipients = recipients.filter(r => r.enabled)

  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 24 }}>仪表盘</h1>

      {/* WeWe RSS login status alert */}
      {weweStatus && !weweStatus.ok && (
        <div style={{
          padding: '12px 16px', marginBottom: 16, borderRadius: 8,
          background: '#fef2f2', border: '1px solid #fecaca',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>&#9888;</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#991b1b' }}>
              WeWe RSS 登录可能已失效
            </div>
            <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 2 }}>
              最后同步于 {weweStatus.lastSync ? weweStatus.lastSync.toLocaleString('zh-CN') : '未知'}
              （已超过 {weweStatus.hoursSince} 小时），公众号新闻可能无法抓取。
            </div>
          </div>
          <a
            href={`${WEWE_RSS_BASE}/dash/feeds`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 14px', background: '#dc2626', color: '#fff',
              borderRadius: 6, fontSize: 13, fontWeight: 500, textDecoration: 'none', whiteSpace: 'nowrap',
            }}
          >
            去重新登录
          </a>
        </div>
      )}
      {weweStatus && weweStatus.ok && (
        <div style={{
          padding: '12px 16px', marginBottom: 16, borderRadius: 8,
          background: '#f0fdf4', border: '1px solid #bbf7d0',
          display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: '#166534',
        }}>
          <span style={{ fontSize: 16 }}>&#10003;</span>
          WeWe RSS 运行正常 — 共 {weweStatus.feedCount} 个源，最后同步于 {weweStatus.lastSync?.toLocaleString('zh-CN')}
        </div>
      )}

      {/* Config summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
        <div style={card}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>发送时间</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {String(settings?.send_hour ?? 18).padStart(2, '0')}:{String(settings?.send_minute ?? 0).padStart(2, '0')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>{settings?.timezone || 'Asia/Shanghai'}</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>新闻条数</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{settings?.max_news_items ?? 10}</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>每日最大</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>新闻源</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {enabledFeeds.length}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text3)' }}>/{feeds.length}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>启用/总数</div>
        </div>
        <div style={card}>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>收件人</div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>
            {enabledRecipients.length}<span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text3)' }}>/{recipients.length}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>启用/总数</div>
        </div>
      </div>

      {/* Source health overview */}
      <div style={{ ...card, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>源健康概览</h2>
        {feeds.length === 0 ? (
          <p style={{ color: 'var(--text3)', fontSize: 14 }}>暂未配置新闻源</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(() => {
              const groups = {}
              feeds.forEach(f => {
                const g = f.group || '未分组'
                if (!groups[g]) groups[g] = { total: 0, enabled: 0 }
                groups[g].total++
                if (f.enabled) groups[g].enabled++
              })
              return Object.entries(groups).map(([group, stats]) => (
                <div key={group} style={{
                  padding: '8px 14px', borderRadius: 8, border: '1px solid var(--border)',
                  background: stats.enabled === stats.total ? '#f0fdf4' : stats.enabled === 0 ? '#fef2f2' : '#fffbeb',
                  fontSize: 13,
                }}>
                  <span style={{ fontWeight: 500 }}>{group}</span>
                  <span style={{ color: 'var(--text2)', marginLeft: 8 }}>{stats.enabled}/{stats.total}</span>
                </div>
              ))
            })()}
          </div>
        )}
      </div>

      {/* Recent send records */}
      <div style={{ ...card, marginBottom: 24 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>最近发送记录</h2>
        {recentDrafts.length === 0 ? (
          <p style={{ color: 'var(--text3)', fontSize: 14 }}>暂无草稿记录</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentDrafts.map(f => (
              <div key={f.name} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '8px 12px', background: '#f9fafb', borderRadius: 6,
                border: '1px solid var(--border)', fontSize: 13,
              }}>
                <span style={{ fontWeight: 500 }}>{f.name.replace('.json', '')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent workflow runs */}
      <div style={card}>
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
