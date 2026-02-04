import React, { useState, useEffect, useRef, useCallback } from 'react'
import { readFile, writeFile, listFiles, getWorkflowRuns, triggerWorkflow, deleteFile } from '../lib/github'
import { getStoredAuth } from '../lib/auth'
import { hasAnthropicKey, generateSummary } from '../lib/claude'
import { generateEmailHtml } from '../lib/emailTemplate'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow)',
}

const WEWE_RSS_BASE = 'https://amb2rzhou.zeabur.app'

const CATEGORY_ICONS = {
  // 聚焦模式 3 分类
  '智能硬件': '🥽', 'AI技术与产品': '🤖', '巨头动向与行业观察': '🏢',
  // 泛 AI 模式 5 分类
  '产品发布': '🚀', '巨头动向': '🏢', '技术进展': '🔬',
  '行业观察': '📊', '投融资': '💰',
}

const btnPrimary = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  fontWeight: 600, fontSize: 14, cursor: 'pointer', transition: 'opacity .15s',
}

export default function Dashboard() {
  const [settings, setSettings] = useState(null)
  const [runs, setRuns] = useState([])
  const [recentDrafts, setRecentDrafts] = useState([])
  const [loading, setLoading] = useState(true)
  const [weweStatus, setWeweStatus] = useState(null)
  const [triggerStatus, setTriggerStatus] = useState({})
  const [latestDraft, setLatestDraft] = useState(null)
  const [draftSha, setDraftSha] = useState(null)
  const [draftExpanded, setDraftExpanded] = useState({})
  const [saving, setSaving] = useState(false)
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const [editingNews, setEditingNews] = useState(null) // { catIdx, newsIdx }
  const [editSummary, setEditSummary] = useState('')
  const [showAddNews, setShowAddNews] = useState(false)
  const [addForm, setAddForm] = useState({ url: '', title: '', summary: '', source: '', category: '' })
  const [aiLoading, setAiLoading] = useState(false)
  const [refetching, setRefetching] = useState(false)
  const pollRef = useRef(null)

  useEffect(() => { load() }, [])

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  async function load() {
    setLoading(true)
    try {
      const settingsFile = await readFile('config/settings.json')
      if (settingsFile) setSettings(JSON.parse(settingsFile.content))

      try {
        const files = await listFiles('config/drafts')
        const sorted = files
          .filter(f => f.name.endsWith('.json'))
          .sort((a, b) => b.name.localeCompare(a.name))
          .slice(0, 7)

        // 加载所有草稿内容以显示状态
        const draftsWithData = await Promise.all(sorted.map(async (f) => {
          try {
            const file = await readFile(`config/drafts/${f.name}`)
            if (file) {
              const data = JSON.parse(file.content)
              return { name: f.name, status: data.status, newsCount: (data.categories || []).reduce((n, c) => n + (c.news || []).length, 0) }
            }
          } catch {}
          return { name: f.name }
        }))
        setRecentDrafts(draftsWithData)

        if (sorted.length > 0) {
          const latestFile = await readFile(`config/drafts/${sorted[0].name}`)
          if (latestFile) {
            setLatestDraft({ name: sorted[0].name, ...JSON.parse(latestFile.content) })
            setDraftSha(latestFile.sha)
          }
        }
      } catch { /* drafts dir may not exist */ }

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

  const handleTrigger = useCallback(async (workflowFile, key) => {
    setTriggerStatus(prev => ({ ...prev, [key]: 'loading' }))
    try {
      await triggerWorkflow(workflowFile)
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

  // Save draft back to GitHub
  async function saveDraft(updatedDraft) {
    if (!latestDraft || !draftSha) return
    setSaving(true)
    try {
      const { name, ...data } = updatedDraft
      const content = JSON.stringify(data, null, 2) + '\n'
      const result = await writeFile(
        `config/drafts/${name}`,
        content,
        `Update draft ${name} via admin UI`,
        draftSha
      )
      setDraftSha(result.content.sha)
      setLatestDraft(updatedDraft)
    } catch (e) {
      alert('保存失败: ' + e.message)
    }
    setSaving(false)
  }

  // Review actions
  async function handleApprove() {
    if (!latestDraft) return
    await saveDraft({ ...latestDraft, status: 'approved' })
  }

  async function handleReject() {
    if (!latestDraft) return
    await saveDraft({ ...latestDraft, status: 'rejected' })
  }

  // Delete a news item
  async function handleDeleteNews(catIdx, newsIdx) {
    if (!latestDraft) return
    const categories = [...latestDraft.categories]
    const cat = { ...categories[catIdx], news: [...categories[catIdx].news] }
    cat.news.splice(newsIdx, 1)
    // Remove empty categories
    if (cat.news.length === 0) {
      categories.splice(catIdx, 1)
    } else {
      categories[catIdx] = cat
    }
    await saveDraft({ ...latestDraft, categories })
  }

  // Save edited summary
  async function handleSaveSummary(catIdx, newsIdx) {
    if (!latestDraft) return
    const categories = [...latestDraft.categories]
    const cat = { ...categories[catIdx], news: [...categories[catIdx].news] }
    cat.news[newsIdx] = { ...cat.news[newsIdx], summary: editSummary }
    categories[catIdx] = cat
    await saveDraft({ ...latestDraft, categories })
    setEditingNews(null)
  }

  // Add news
  async function handleAddNews() {
    if (!addForm.title.trim() || !addForm.category) {
      alert('标题和分类为必填项')
      return
    }
    if (!latestDraft) return

    const newItem = {
      title: addForm.title.trim(),
      url: addForm.url.trim() || '#',
      summary: addForm.summary.trim(),
      source: addForm.source.trim(),
    }

    const categories = [...latestDraft.categories]
    const catIdx = categories.findIndex(c => c.name === addForm.category)
    if (catIdx >= 0) {
      const cat = { ...categories[catIdx], news: [...categories[catIdx].news, newItem] }
      categories[catIdx] = cat
    } else {
      categories.push({ name: addForm.category, news: [newItem] })
    }

    await saveDraft({ ...latestDraft, categories })
    setAddForm({ url: '', title: '', summary: '', source: '', category: '' })
    setShowAddNews(false)
  }

  // AI generate summary
  async function handleAiSummary() {
    if (!addForm.title.trim()) {
      alert('请先填写标题')
      return
    }
    setAiLoading(true)
    try {
      const summary = await generateSummary(addForm.title, addForm.url)
      setAddForm(prev => ({ ...prev, summary }))
    } catch (e) {
      alert('AI 摘要生成失败: ' + e.message)
    }
    setAiLoading(false)
  }

  const stored = getStoredAuth()

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

  const triggerBtnLabel = (key, defaultLabel) => {
    const s = triggerStatus[key]
    if (s === 'loading') return '触发中...'
    if (s === 'success') return '已触发 ✓'
    if (s === 'error') return '失败 ✗'
    return defaultLabel
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

  const feeds = settings?.rss_feeds || []
  const enabledFeeds = feeds.filter(f => f.enabled)
  const recipients = settings?.recipients || []
  const enabledRecipients = recipients.filter(r => r.enabled)
  const categoryOptions = settings?.categories_order || Object.keys(CATEGORY_ICONS)

  return (
    <div>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>

      <h1 style={{ fontSize: 22, marginBottom: 24 }}>仪表盘</h1>

      {/* Workflow trigger buttons */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button
          onClick={async () => {
            if (latestDraft && draftSha) {
              // 有草稿，先删除再抓取
              if (!confirm('确定要删除当前草稿并重新抓取吗？')) return
              setRefetching(true)
              try {
                await deleteFile(
                  `config/drafts/${latestDraft.name}`,
                  `Delete draft ${latestDraft.name} for re-fetch`,
                  draftSha
                )
                setLatestDraft(null)
                setDraftSha(null)
              } catch (e) {
                alert('删除草稿失败: ' + e.message)
                setRefetching(false)
                return
              }
              setRefetching(false)
            }
            handleTrigger('fetch-news.yml', 'fetch')
          }}
          disabled={triggerStatus.fetch === 'loading' || refetching}
          style={{
            ...btnPrimary, background: '#2563eb', color: '#fff',
            opacity: (triggerStatus.fetch === 'loading' || refetching) ? 0.6 : 1,
          }}
        >
          {refetching ? '删除中...' : triggerBtnLabel('fetch', latestDraft ? '重新抓取' : '抓取新闻')}
        </button>
        <button
          onClick={() => handleTrigger('send-email.yml', 'send')}
          disabled={triggerStatus.send === 'loading'}
          style={{
            ...btnPrimary, background: '#059669', color: '#fff',
            opacity: triggerStatus.send === 'loading' ? 0.6 : 1,
          }}
        >
          {triggerBtnLabel('send', '发送邮件')}
        </button>
        <button
          onClick={() => handleTrigger('send-webhook.yml', 'webhook')}
          disabled={triggerStatus.webhook === 'loading'}
          style={{
            ...btnPrimary, background: '#ea580c', color: '#fff',
            opacity: triggerStatus.webhook === 'loading' ? 0.6 : 1,
          }}
        >
          {triggerBtnLabel('webhook', '推送群聊')}
        </button>
        {(triggerStatus.fetch === 'success' || triggerStatus.send === 'success' || triggerStatus.webhook === 'success') && (
          <span style={{ fontSize: 13, color: 'var(--success)', alignSelf: 'center' }}>
            Workflow 已触发，运行记录将自动刷新
          </span>
        )}
        {(triggerStatus.fetch === 'error' || triggerStatus.send === 'error' || triggerStatus.webhook === 'error') && (
          <span style={{ fontSize: 13, color: 'var(--danger)', alignSelf: 'center' }}>
            触发失败，请检查 Token 权限
          </span>
        )}
      </div>

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
                {f.status && statusBadge(f.status)}
                {f.newsCount != null && <span style={{ color: 'var(--text3)', fontSize: 12 }}>{f.newsCount} 条</span>}
              </div>
            ))}
          </div>
        )}
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

      {/* Latest news preview */}
      {latestDraft && (() => {
        const isDone = latestDraft.status === 'sent' || latestDraft.status === 'rejected'
        const isEditable = !isDone
        return (
        <div style={card}>
          {/* Review action bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isDone ? 0 : 16, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 16, margin: 0 }}>最新新闻预览</h2>
            {statusBadge(latestDraft.status)}
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>{latestDraft.name.replace('.json', '')}</span>
            {latestDraft.time_window && <span style={{ fontSize: 12, color: 'var(--text3)' }}>{latestDraft.time_window}</span>}
            <div style={{ flex: 1 }} />
            {saving && <span style={{ fontSize: 12, color: 'var(--text2)' }}>保存中...</span>}
            {latestDraft.status === 'pending_review' && (
              <>
                <button
                  onClick={handleApprove}
                  disabled={saving}
                  style={{ ...btnPrimary, background: '#059669', color: '#fff', padding: '6px 16px', fontSize: 13 }}
                >
                  批准发送
                </button>
                <button
                  onClick={handleReject}
                  disabled={saving}
                  style={{ ...btnPrimary, background: '#dc2626', color: '#fff', padding: '6px 16px', fontSize: 13 }}
                >
                  拒绝/跳过
                </button>
              </>
            )}
            <button
              onClick={() => setShowEmailPreview(true)}
              style={{ ...btnPrimary, background: '#6366f1', color: '#fff', padding: '6px 16px', fontSize: 13 }}
            >
              预览邮件
            </button>
          </div>

          {isEditable && <>
          {/* Add news collapsible */}
          <div style={{ marginBottom: 16 }}>
            <button
              onClick={() => setShowAddNews(!showAddNews)}
              style={{
                background: 'none', border: '1px dashed var(--border)', borderRadius: 6,
                padding: '8px 16px', fontSize: 13, cursor: 'pointer', color: 'var(--primary)',
                width: '100%', textAlign: 'left',
              }}
            >
              {showAddNews ? '▼ 收起添加新闻' : '＋ 添加新闻'}
            </button>
            {showAddNews && (
              <div style={{
                marginTop: 8, padding: 16, border: '1px solid var(--border)',
                borderRadius: 8, background: '#f9fafb',
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ gridColumn: '1 / -1' }}>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>URL</span>
                    <input
                      type="url"
                      value={addForm.url}
                      onChange={e => setAddForm(prev => ({ ...prev, url: e.target.value }))}
                      placeholder="https://..."
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                      标题 <span style={{ color: 'var(--danger)' }}>*</span>
                    </span>
                    <input
                      type="text"
                      value={addForm.title}
                      onChange={e => setAddForm(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="新闻标题"
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>来源</span>
                    <input
                      type="text"
                      value={addForm.source}
                      onChange={e => setAddForm(prev => ({ ...prev, source: e.target.value }))}
                      placeholder="来源名称"
                      style={{ width: '100%' }}
                    />
                  </label>
                  <label style={{ gridColumn: '1 / -1' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>摘要</span>
                      {hasAnthropicKey() && (
                        <button
                          onClick={handleAiSummary}
                          disabled={aiLoading}
                          style={{
                            background: '#eef2ff', color: '#4f46e5', border: 'none', borderRadius: 4,
                            padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 500,
                          }}
                        >
                          {aiLoading ? '生成中...' : 'AI 生成摘要'}
                        </button>
                      )}
                    </div>
                    <textarea
                      value={addForm.summary}
                      onChange={e => setAddForm(prev => ({ ...prev, summary: e.target.value }))}
                      placeholder="新闻摘要（可选）"
                      rows={2}
                      style={{ width: '100%', resize: 'vertical' }}
                    />
                  </label>
                  <label>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>
                      分类 <span style={{ color: 'var(--danger)' }}>*</span>
                    </span>
                    <select
                      value={addForm.category}
                      onChange={e => setAddForm(prev => ({ ...prev, category: e.target.value }))}
                      style={{ width: '100%' }}
                    >
                      <option value="">选择分类...</option>
                      {categoryOptions.map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      onClick={handleAddNews}
                      disabled={saving}
                      style={{ ...btnPrimary, background: 'var(--primary)', color: '#fff', padding: '8px 24px' }}
                    >
                      添加
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
          </>}

          {/* News categories */}
          {isEditable && (latestDraft.categories || []).map((cat, catIdx) => {
            const catKey = cat.name || catIdx
            const isExpanded = draftExpanded[catKey]
            return (
              <div key={catIdx} style={{ marginBottom: 8 }}>
                <div
                  onClick={() => setDraftExpanded(prev => ({ ...prev, [catKey]: !prev[catKey] }))}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}
                >
                  <span style={{ fontSize: 12, color: 'var(--text2)' }}>{isExpanded ? '▼' : '▶'}</span>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>
                    {CATEGORY_ICONS[cat.name] || '📰'} {cat.name}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>({(cat.news || []).length})</span>
                </div>
                {isExpanded && (cat.news || []).map((item, newsIdx) => {
                  const isEditing = editingNews?.catIdx === catIdx && editingNews?.newsIdx === newsIdx
                  return (
                    <div key={newsIdx} style={{
                      padding: '10px 14px', marginBottom: 6, marginLeft: 20, borderRadius: 6,
                      border: '1px solid var(--border)', background: '#fafafa',
                      position: 'relative',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ flex: 1 }}>
                          <a href={item.url} target="_blank" rel="noopener" style={{ fontWeight: 500, fontSize: 13 }}>
                            {item.title}
                          </a>
                          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{item.source}</div>
                        </div>
                        <button
                          onClick={() => handleDeleteNews(catIdx, newsIdx)}
                          disabled={saving}
                          title="删除"
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: '#dc2626', fontSize: 16, padding: '0 4px', lineHeight: 1,
                            opacity: saving ? 0.5 : 1,
                          }}
                        >
                          &times;
                        </button>
                      </div>
                      {isEditing ? (
                        <div style={{ marginTop: 6 }}>
                          <textarea
                            value={editSummary}
                            onChange={e => setEditSummary(e.target.value)}
                            onBlur={() => handleSaveSummary(catIdx, newsIdx)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveSummary(catIdx, newsIdx) } }}
                            autoFocus
                            rows={2}
                            style={{ width: '100%', fontSize: 13, resize: 'vertical' }}
                          />
                          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Enter 保存，Shift+Enter 换行</div>
                        </div>
                      ) : (
                        item.summary && (
                          <p
                            onClick={() => { setEditingNews({ catIdx, newsIdx }); setEditSummary(item.summary) }}
                            style={{
                              fontSize: 13, color: 'var(--text2)', marginTop: 6, lineHeight: 1.5,
                              cursor: 'pointer', borderBottom: '1px dashed transparent',
                            }}
                            onMouseEnter={e => e.currentTarget.style.borderBottomColor = 'var(--text3)'}
                            onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'transparent'}
                            title="点击编辑摘要"
                          >
                            {item.summary}
                          </p>
                        )
                      )}
                      {item.comment && (
                        <p style={{
                          fontSize: 12, color: '#7c3aed', marginTop: 6, lineHeight: 1.5,
                          padding: '6px 10px', background: '#f5f3ff', borderRadius: 6,
                          borderLeft: '3px solid #8b5cf6',
                        }}>
                          <span style={{ fontWeight: 500 }}>🤔 </span>{item.comment}
                        </p>
                      )}
                      {!isEditing && !item.summary && (
                        <button
                          onClick={() => { setEditingNews({ catIdx, newsIdx }); setEditSummary('') }}
                          style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--text3)', fontSize: 12, padding: 0, marginTop: 4,
                          }}
                        >
                          + 添加摘要
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
          {isEditable && (!latestDraft.categories || latestDraft.categories.length === 0) && (
            <p style={{ color: 'var(--text3)', fontSize: 14 }}>该草稿暂无新闻内容</p>
          )}
        </div>
        )
      })()}

      {/* Email preview modal */}
      {showEmailPreview && latestDraft && (
        <div
          onClick={() => setShowEmailPreview(false)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.5)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: 12, width: '100%', maxWidth: 700,
              maxHeight: '90vh', display: 'flex', flexDirection: 'column',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', padding: '12px 20px',
              borderBottom: '1px solid #e5e7eb',
            }}>
              <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>邮件预览</h3>
              <button
                onClick={() => setShowEmailPreview(false)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 20, color: '#6b7280', padding: '0 4px',
                }}
              >
                &times;
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <iframe
                srcDoc={generateEmailHtml(latestDraft, settings)}
                style={{ width: '100%', height: '80vh', border: 'none' }}
                title="Email Preview"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
