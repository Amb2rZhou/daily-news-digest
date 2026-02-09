import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { readFile, writeFile, listFiles, getWorkflowRuns, triggerWorkflow } from '../lib/github'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow)',
}

const WEWE_RSS_BASE = 'https://amb2rzhou.zeabur.app'

const btnPrimary = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  fontWeight: 600, fontSize: 14, cursor: 'pointer', transition: 'opacity .15s',
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState(null)
  const [runs, setRuns] = useState([])
  const [loading, setLoading] = useState(true)
  const [weweStatus, setWeweStatus] = useState(null)
  const [triggerStatus, setTriggerStatus] = useState({})
  const [channelDraftInfo, setChannelDraftInfo] = useState({}) // { channelId: { status, newsCount } }
  const pollRef = useRef(null)

  useEffect(() => { load() }, [])
  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  async function load() {
    setLoading(true)
    try {
      const settingsFile = await readFile('config/settings.json')
      let parsedSettings = null
      if (settingsFile) {
        parsedSettings = JSON.parse(settingsFile.content)
        setSettings(parsedSettings)
      }

      // Load draft info for all channels
      if (parsedSettings) {
        const channels = (parsedSettings.channels || []).filter(c => c.enabled)
        const today = new Date().toISOString().slice(0, 10)
        const draftInfo = {}

        await Promise.all(channels.map(async (ch) => {
          const fname = ch.type === 'email' ? `${today}.json` : `${today}_ch_${ch.id}.json`
          try {
            const file = await readFile(`config/drafts/${fname}`)
            if (file) {
              const data = JSON.parse(file.content)
              draftInfo[ch.id] = {
                status: data.status || 'pending_review',
                newsCount: (data.categories || []).reduce((n, c) => n + (c.news || []).length, 0),
              }
            }
          } catch { /* draft may not exist */ }
        }))
        setChannelDraftInfo(draftInfo)
      }

      // WeWe RSS status
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

      await loadRuns()
    } catch (e) {
      console.error('Dashboard load error:', e)
    }
    setLoading(false)
  }

  async function loadRuns() {
    try {
      const fetchRuns = await getWorkflowRuns('fetch-news.yml', 5)
      const sendRuns = await getWorkflowRuns('send-email.yml', 5)
      setRuns([
        ...(fetchRuns.workflow_runs || []).map(r => ({ ...r, type: 'fetch' })),
        ...(sendRuns.workflow_runs || []).map(r => ({ ...r, type: 'send' })),
      ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 10))
    } catch { /* workflow may not exist yet */ }
  }

  const handleTrigger = useCallback(async (workflowFile, key, inputs = {}) => {
    setTriggerStatus(prev => ({ ...prev, [key]: 'loading' }))
    try {
      await triggerWorkflow(workflowFile, 'main', inputs)
      setTriggerStatus(prev => ({ ...prev, [key]: 'success' }))

      let elapsed = 0
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(async () => {
        elapsed += 10
        await loadRuns()
        if (elapsed >= 60) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }, 10000)

      setTimeout(() => setTriggerStatus(prev => ({ ...prev, [key]: null })), 5000)
    } catch (e) {
      console.error('Trigger error:', e)
      setTriggerStatus(prev => ({ ...prev, [key]: 'error' }))
      setTimeout(() => setTriggerStatus(prev => ({ ...prev, [key]: null })), 5000)
    }
  }, [])

  const triggerBtnLabel = (key, defaultLabel) => {
    const s = triggerStatus[key]
    if (s === 'loading') return '触发中...'
    if (s === 'success') return '已触发'
    if (s === 'error') return '失败'
    return defaultLabel
  }

  const statusBadge = (status) => {
    const map = {
      pending_review: { bg: '#fef3c7', color: '#d97706', label: '待审核' },
      approved: { bg: '#dbeafe', color: '#2563eb', label: '已审核' },
      sent: { bg: '#d1fae5', color: '#059669', label: '已发送' },
      rejected: { bg: '#fee2e2', color: '#dc2626', label: '已拒绝' },
    }
    const s = map[status] || { bg: '#f3f4f6', color: '#6b7280', label: status || '无草稿' }
    return <span style={{ background: s.bg, color: s.color, padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 500 }}>{s.label}</span>
  }

  const runStatusBadge = (status, conclusion) => {
    if (status === 'completed') {
      if (conclusion === 'success') return <span style={{ color: 'var(--success)', fontSize: 12 }}>成功</span>
      return <span style={{ color: 'var(--danger)', fontSize: 12 }}>{conclusion}</span>
    }
    if (status === 'in_progress' || status === 'queued') {
      return (
        <span style={{ color: 'var(--warn)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{
            display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
            background: 'var(--warn)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
          {status === 'in_progress' ? '进行中' : '排队中'}
        </span>
      )
    }
    return <span style={{ color: 'var(--text2)', fontSize: 12 }}>{status}</span>
  }

  if (loading) return <p style={{ color: 'var(--text2)' }}>加载中...</p>

  const channels = (settings?.channels || []).filter(c => c.enabled)

  return (
    <div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>

      <h1 style={{ fontSize: 22, marginBottom: 24 }}>仪表盘</h1>

      {/* Workflow trigger buttons */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => handleTrigger('fetch-news.yml', 'fetch')}
          disabled={triggerStatus.fetch === 'loading'}
          style={{
            ...btnPrimary, background: '#2563eb', color: '#fff',
            opacity: triggerStatus.fetch === 'loading' ? 0.6 : 1,
          }}
        >
          {triggerBtnLabel('fetch', '抓取新闻')}
        </button>
        {(triggerStatus.fetch === 'success' || triggerStatus.send === 'success') && (
          <span style={{ fontSize: 13, color: 'var(--success)', alignSelf: 'center' }}>
            Workflow 已触发，运行记录将自动刷新
          </span>
        )}
        {(triggerStatus.fetch === 'error' || triggerStatus.send === 'error') && (
          <span style={{ fontSize: 13, color: 'var(--danger)', alignSelf: 'center' }}>
            触发失败，请检查 Token 权限
          </span>
        )}
      </div>

      {/* WeWe RSS status */}
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

      {/* Channel grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 16,
        marginBottom: 24,
      }}>
        {channels.map(ch => {
          const info = channelDraftInfo[ch.id]
          const isEmail = ch.type === 'email'
          return (
            <div
              key={ch.id}
              onClick={() => navigate(`/channel/${ch.id}`)}
              style={{
                ...card,
                cursor: 'pointer',
                transition: 'box-shadow .15s, transform .15s',
                borderLeft: `4px solid ${isEmail ? '#2563eb' : '#059669'}`,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)'
                e.currentTarget.style.transform = 'translateY(-2px)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.boxShadow = 'var(--shadow)'
                e.currentTarget.style.transform = 'translateY(0)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>{ch.name || ch.id}</span>
                <span style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4, fontWeight: 500,
                  background: isEmail ? '#dbeafe' : '#dcfce7',
                  color: isEmail ? '#1d4ed8' : '#166534',
                }}>
                  {isEmail ? '邮件' : 'Webhook'}
                </span>
              </div>

              {ch.description && (
                <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>{ch.description}</div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text2)' }}>
                  {String(ch.send_hour ?? 10).padStart(2, '0')}:{String(ch.send_minute ?? 0).padStart(2, '0')}
                </span>
                <span style={{ fontSize: 11, color: '#6366f1', background: '#eef2ff', padding: '2px 8px', borderRadius: 4 }}>
                  {ch.topic_mode === 'focused' ? '聚焦' : '泛AI'}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {info ? (
                  <>
                    {statusBadge(info.status)}
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>{info.newsCount} 条</span>
                  </>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>暂无草稿</span>
                )}
              </div>
            </div>
          )
        })}

        {/* Add channel card */}
        <div
          onClick={() => navigate('/settings')}
          style={{
            ...card,
            cursor: 'pointer',
            border: '2px dashed var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: 120,
            color: 'var(--text3)',
            fontSize: 14,
            transition: 'border-color .15s, color .15s',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--primary)'
            e.currentTarget.style.color = 'var(--primary)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.color = 'var(--text3)'
          }}
        >
          + 添加频道
        </div>
      </div>

      {/* Recent workflow runs */}
      <div style={{ ...card, marginBottom: 24 }}>
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
                <tr
                  key={r.id}
                  onClick={() => {
                    if (r.html_url) window.open(r.html_url, '_blank')
                  }}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    cursor: r.html_url ? 'pointer' : 'default',
                    transition: 'background .1s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
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
