import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { readFile, writeFile, listFiles, triggerWorkflow, deleteFile } from '../lib/github'
import { hasAnthropicKey, generateSummary } from '../lib/claude'
import { generateEmailHtml } from '../lib/emailTemplate'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 20, boxShadow: 'var(--shadow)',
}

const CATEGORY_ICONS = {
  '智能硬件': '🥽', 'AI技术与产品': '🤖', '巨头动向与行业观察': '🏢',
  '产品发布': '🚀', '巨头动向': '🏢', '技术进展': '🔬',
  '行业观察': '📊', '投融资': '💰',
}

const btnPrimary = {
  padding: '8px 20px', borderRadius: 6, border: 'none',
  fontWeight: 600, fontSize: 14, cursor: 'pointer', transition: 'opacity .15s',
}

const TABS = [
  { key: 'draft', label: '概览与草稿' },
  { key: 'settings', label: '频道设置' },
  { key: 'recipients', label: '收件人' },
  { key: 'template', label: '消息模板' },
  { key: 'history', label: '发送历史' },
]

export default function ChannelDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [settings, setSettings] = useState(null)
  const [settingsSha, setSettingsSha] = useState(null)
  const [channel, setChannel] = useState(null)
  const [activeTab, setActiveTab] = useState('draft')
  const [loading, setLoading] = useState(true)

  // Draft tab state
  const [draft, setDraft] = useState(null)
  const [draftSha, setDraftSha] = useState(null)
  const [draftExpanded, setDraftExpanded] = useState({})
  const [saving, setSaving] = useState(false)
  const [editingNews, setEditingNews] = useState(null)
  const [editSummary, setEditSummary] = useState('')
  const [showAddNews, setShowAddNews] = useState(false)
  const [addForm, setAddForm] = useState({ url: '', title: '', summary: '', source: '', category: '' })
  const [aiLoading, setAiLoading] = useState(false)
  const [showEmailPreview, setShowEmailPreview] = useState(false)
  const [triggerStatus, setTriggerStatus] = useState({})

  // Settings tab state
  const [settingsSaving, setSettingsSaving] = useState(false)

  // History tab state
  const [historyDrafts, setHistoryDrafts] = useState([])
  const [historyExpanded, setHistoryExpanded] = useState({})
  const [historyData, setHistoryData] = useState({})
  const [historyLoading, setHistoryLoading] = useState(false)

  useEffect(() => { load() }, [id])

  async function load() {
    setLoading(true)
    try {
      const file = await readFile('config/settings.json')
      if (file) {
        const parsed = JSON.parse(file.content)
        setSettings(parsed)
        setSettingsSha(file.sha)
        const ch = (parsed.channels || []).find(c => c.id === id)
        setChannel(ch || null)
      }

      // Load today's draft
      const today = new Date().toISOString().slice(0, 10)
      const fname = id === 'email' ? `${today}.json` : `${today}_ch_${id}.json`
      try {
        const draftFile = await readFile(`config/drafts/${fname}`)
        if (draftFile) {
          setDraft({ name: fname, ...JSON.parse(draftFile.content) })
          setDraftSha(draftFile.sha)
        }
      } catch { /* draft may not exist */ }
    } catch (e) {
      console.error('Load error:', e)
    }
    setLoading(false)
  }

  // Save draft
  async function saveDraft(updatedDraft) {
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
      setDraft(updatedDraft)
    } catch (e) {
      alert('保存失败: ' + e.message)
    }
    setSaving(false)
  }

  // Save settings
  async function saveSettings() {
    if (!settings) return
    setSettingsSaving(true)
    try {
      const content = JSON.stringify(settings, null, 2) + '\n'
      const result = await writeFile(
        'config/settings.json',
        content,
        'Update channel settings via admin UI',
        settingsSha
      )
      setSettingsSha(result.content.sha)
      alert('设置已保存')
    } catch (e) {
      alert('保存失败: ' + e.message)
    }
    setSettingsSaving(false)
  }

  function updateChannelField(key, value) {
    setSettings(prev => {
      const channels = [...(prev.channels || [])]
      const idx = channels.findIndex(c => c.id === id)
      if (idx >= 0) {
        channels[idx] = { ...channels[idx], [key]: value }
        setChannel(channels[idx])
      }
      return { ...prev, channels }
    })
  }

  // Approve/Reject
  async function handleApprove() {
    if (!draft) return
    await saveDraft({ ...draft, status: 'approved' })
    handleTrigger('send-email.yml', 'send', { channel_id: id })
  }

  async function handleReject() {
    if (!draft) return
    await saveDraft({ ...draft, status: 'rejected' })
  }

  // Delete news
  async function handleDeleteNews(catIdx, newsIdx) {
    if (!draft) return
    const categories = [...draft.categories]
    const cat = { ...categories[catIdx], news: [...categories[catIdx].news] }
    cat.news.splice(newsIdx, 1)
    if (cat.news.length === 0) {
      categories.splice(catIdx, 1)
    } else {
      categories[catIdx] = cat
    }
    await saveDraft({ ...draft, categories })
  }

  // Save edited summary
  async function handleSaveSummary(catIdx, newsIdx) {
    if (!draft) return
    const categories = [...draft.categories]
    const cat = { ...categories[catIdx], news: [...categories[catIdx].news] }
    cat.news[newsIdx] = { ...cat.news[newsIdx], summary: editSummary }
    categories[catIdx] = cat
    await saveDraft({ ...draft, categories })
    setEditingNews(null)
  }

  // Add news
  async function handleAddNews() {
    if (!addForm.title.trim() || !addForm.category) {
      alert('标题和分类为必填项')
      return
    }
    if (!draft) return
    const newItem = {
      title: addForm.title.trim(),
      url: addForm.url.trim() || '#',
      summary: addForm.summary.trim(),
      source: addForm.source.trim(),
    }
    const categories = [...draft.categories]
    const catIdx = categories.findIndex(c => c.name === addForm.category)
    if (catIdx >= 0) {
      categories[catIdx] = { ...categories[catIdx], news: [...categories[catIdx].news, newItem] }
    } else {
      categories.push({ name: addForm.category, news: [newItem] })
    }
    await saveDraft({ ...draft, categories })
    setAddForm({ url: '', title: '', summary: '', source: '', category: '' })
    setShowAddNews(false)
  }

  // AI summary
  async function handleAiSummary() {
    if (!addForm.title.trim()) { alert('请先填写标题'); return }
    setAiLoading(true)
    try {
      const summary = await generateSummary(addForm.title, addForm.url)
      setAddForm(prev => ({ ...prev, summary }))
    } catch (e) {
      alert('AI 摘要生成失败: ' + e.message)
    }
    setAiLoading(false)
  }

  // Trigger workflow
  const handleTrigger = useCallback(async (workflowFile, key, inputs = {}) => {
    setTriggerStatus(prev => ({ ...prev, [key]: 'loading' }))
    try {
      await triggerWorkflow(workflowFile, 'main', inputs)
      setTriggerStatus(prev => ({ ...prev, [key]: 'success' }))
      setTimeout(() => setTriggerStatus(prev => ({ ...prev, [key]: null })), 5000)
    } catch (e) {
      console.error('Trigger error:', e)
      setTriggerStatus(prev => ({ ...prev, [key]: 'error' }))
      setTimeout(() => setTriggerStatus(prev => ({ ...prev, [key]: null })), 5000)
    }
  }, [])

  // Load history
  async function loadHistory() {
    if (historyDrafts.length > 0) return // already loaded
    setHistoryLoading(true)
    try {
      const files = await listFiles('config/drafts')
      const isEmail = id === 'email'
      const filtered = files
        .filter(f => {
          if (isEmail) return f.name.endsWith('.json') && !f.name.includes('_ch_')
          return f.name.includes(`_ch_${id}.json`)
        })
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, 30)
      setHistoryDrafts(filtered)

      const dataMap = {}
      await Promise.all(filtered.map(async (f) => {
        try {
          const file = await readFile(`config/drafts/${f.name}`)
          if (file) dataMap[f.name] = JSON.parse(file.content)
        } catch { /* ignore */ }
      }))
      setHistoryData(dataMap)
    } catch (e) {
      console.error('Load history error:', e)
    }
    setHistoryLoading(false)
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

  const triggerBtnLabel = (key, defaultLabel) => {
    const s = triggerStatus[key]
    if (s === 'loading') return '触发中...'
    if (s === 'success') return '已触发'
    if (s === 'error') return '失败'
    return defaultLabel
  }

  if (loading) return <p style={{ color: 'var(--text2)' }}>加载中...</p>
  if (!channel) return (
    <div>
      <p style={{ color: 'var(--text2)' }}>频道 "{id}" 未找到</p>
      <button onClick={() => navigate('/')} style={{ ...btnPrimary, background: 'var(--primary)', color: '#fff', marginTop: 12 }}>
        返回仪表盘
      </button>
    </div>
  )

  const isEmail = channel.type === 'email'
  const categoryOptions = settings?.categories_order || Object.keys(CATEGORY_ICONS)

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          onClick={() => navigate('/')}
          style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text2)', padding: '4px 8px' }}
        >
          &larr;
        </button>
        <h1 style={{ fontSize: 22, flex: 1 }}>{channel.name || id}</h1>
        <span style={{
          fontSize: 12, padding: '4px 12px', borderRadius: 6, fontWeight: 500,
          background: isEmail ? '#dbeafe' : '#dcfce7',
          color: isEmail ? '#1d4ed8' : '#166534',
        }}>
          {isEmail ? '邮件频道' : 'Webhook 频道'}
        </span>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--border)', marginBottom: 24 }}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key)
              if (tab.key === 'history') loadHistory()
            }}
            style={{
              padding: '10px 20px', border: 'none', cursor: 'pointer',
              fontSize: 14, fontWeight: activeTab === tab.key ? 600 : 400,
              background: activeTab === tab.key ? 'var(--card)' : 'transparent',
              borderBottom: activeTab === tab.key ? '2px solid var(--primary)' : '2px solid transparent',
              marginBottom: -2, borderRadius: '8px 8px 0 0',
              color: activeTab === tab.key ? 'var(--text)' : 'var(--text2)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab: Draft */}
      {activeTab === 'draft' && (
        <div>
          {/* Action bar */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={() => handleTrigger('fetch-news.yml', 'fetch')}
              disabled={triggerStatus.fetch === 'loading'}
              style={{ ...btnPrimary, background: '#2563eb', color: '#fff', opacity: triggerStatus.fetch === 'loading' ? 0.6 : 1 }}
            >
              {triggerBtnLabel('fetch', '抓取新闻')}
            </button>
            <button
              onClick={() => handleTrigger('send-email.yml', 'send', { channel_id: id })}
              disabled={triggerStatus.send === 'loading'}
              style={{ ...btnPrimary, background: '#059669', color: '#fff', opacity: triggerStatus.send === 'loading' ? 0.6 : 1 }}
            >
              {triggerBtnLabel('send', '发送此频道')}
            </button>
            {triggerStatus.fetch === 'success' || triggerStatus.send === 'success' ? (
              <span style={{ fontSize: 13, color: 'var(--success)' }}>Workflow 已触发</span>
            ) : null}
          </div>

          {draft ? (() => {
            const isDone = draft.status === 'sent' || draft.status === 'rejected'
            const isEditable = !isDone
            return (
              <div style={card}>
                {/* Draft header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: isDone ? 0 : 16, flexWrap: 'wrap' }}>
                  <h2 style={{ fontSize: 16, margin: 0 }}>今日草稿</h2>
                  {statusBadge(draft.status)}
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>{draft.name?.replace('.json', '')}</span>
                  {draft.topic_mode && <span style={{ fontSize: 11, color: '#6366f1', background: '#eef2ff', padding: '2px 8px', borderRadius: 4 }}>{draft.topic_mode}</span>}
                  <div style={{ flex: 1 }} />
                  {saving && <span style={{ fontSize: 12, color: 'var(--text2)' }}>保存中...</span>}
                  {draft.status === 'pending_review' && (
                    <>
                      <button onClick={handleApprove} disabled={saving} style={{ ...btnPrimary, background: '#059669', color: '#fff', padding: '6px 16px', fontSize: 13 }}>
                        批准发送
                      </button>
                      <button onClick={handleReject} disabled={saving} style={{ ...btnPrimary, background: '#dc2626', color: '#fff', padding: '6px 16px', fontSize: 13 }}>
                        拒绝/跳过
                      </button>
                    </>
                  )}
                  {isEmail && (
                    <button onClick={() => setShowEmailPreview(true)} style={{ ...btnPrimary, background: '#6366f1', color: '#fff', padding: '6px 16px', fontSize: 13 }}>
                      预览邮件
                    </button>
                  )}
                </div>

                {isEditable && <>
                  {/* Add news */}
                  <div style={{ marginBottom: 16 }}>
                    <button
                      onClick={() => setShowAddNews(!showAddNews)}
                      style={{
                        background: 'none', border: '1px dashed var(--border)', borderRadius: 6,
                        padding: '8px 16px', fontSize: 13, cursor: 'pointer', color: 'var(--primary)',
                        width: '100%', textAlign: 'left',
                      }}
                    >
                      {showAddNews ? '收起添加新闻' : '+ 添加新闻'}
                    </button>
                    {showAddNews && (
                      <div style={{ marginTop: 8, padding: 16, border: '1px solid var(--border)', borderRadius: 8, background: '#f9fafb' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <label style={{ gridColumn: '1 / -1' }}>
                            <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>URL</span>
                            <input type="url" value={addForm.url} onChange={e => setAddForm(prev => ({ ...prev, url: e.target.value }))} placeholder="https://..." style={{ width: '100%' }} />
                          </label>
                          <label>
                            <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>标题 *</span>
                            <input type="text" value={addForm.title} onChange={e => setAddForm(prev => ({ ...prev, title: e.target.value }))} placeholder="新闻标题" style={{ width: '100%' }} />
                          </label>
                          <label>
                            <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>来源</span>
                            <input type="text" value={addForm.source} onChange={e => setAddForm(prev => ({ ...prev, source: e.target.value }))} placeholder="来源名称" style={{ width: '100%' }} />
                          </label>
                          <label style={{ gridColumn: '1 / -1' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                              <span style={{ fontSize: 12, fontWeight: 500 }}>摘要</span>
                              {hasAnthropicKey() && (
                                <button onClick={handleAiSummary} disabled={aiLoading} style={{ background: '#eef2ff', color: '#4f46e5', border: 'none', borderRadius: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>
                                  {aiLoading ? '生成中...' : 'AI 生成摘要'}
                                </button>
                              )}
                            </div>
                            <textarea value={addForm.summary} onChange={e => setAddForm(prev => ({ ...prev, summary: e.target.value }))} placeholder="新闻摘要" rows={2} style={{ width: '100%', resize: 'vertical' }} />
                          </label>
                          <label>
                            <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>分类 *</span>
                            <select value={addForm.category} onChange={e => setAddForm(prev => ({ ...prev, category: e.target.value }))} style={{ width: '100%' }}>
                              <option value="">选择分类...</option>
                              {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          </label>
                          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                            <button onClick={handleAddNews} disabled={saving} style={{ ...btnPrimary, background: 'var(--primary)', color: '#fff', padding: '8px 24px' }}>添加</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* News categories */}
                  {(draft.categories || []).map((cat, catIdx) => {
                    const catKey = cat.name || catIdx
                    const isExpanded = draftExpanded[catKey]
                    return (
                      <div key={catIdx} style={{ marginBottom: 8 }}>
                        <div onClick={() => setDraftExpanded(prev => ({ ...prev, [catKey]: !prev[catKey] }))} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
                          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{isExpanded ? '▼' : '▶'}</span>
                          <span style={{ fontSize: 14, fontWeight: 500 }}>{CATEGORY_ICONS[cat.name] || '📰'} {cat.name}</span>
                          <span style={{ fontSize: 12, color: 'var(--text3)' }}>({(cat.news || []).length})</span>
                        </div>
                        {isExpanded && (cat.news || []).map((item, newsIdx) => {
                          const isEditing = editingNews?.catIdx === catIdx && editingNews?.newsIdx === newsIdx
                          return (
                            <div key={newsIdx} style={{ padding: '10px 14px', marginBottom: 6, marginLeft: 20, borderRadius: 6, border: '1px solid var(--border)', background: '#fafafa' }}>
                              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                <div style={{ flex: 1 }}>
                                  <a href={item.url} target="_blank" rel="noopener" style={{ fontWeight: 500, fontSize: 13 }}>{item.title}</a>
                                  <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{item.source}</div>
                                </div>
                                <button onClick={() => handleDeleteNews(catIdx, newsIdx)} disabled={saving} title="删除" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 16, padding: '0 4px', opacity: saving ? 0.5 : 1 }}>&times;</button>
                              </div>
                              {isEditing ? (
                                <div style={{ marginTop: 6 }}>
                                  <textarea value={editSummary} onChange={e => setEditSummary(e.target.value)} onBlur={() => handleSaveSummary(catIdx, newsIdx)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSaveSummary(catIdx, newsIdx) } }} autoFocus rows={2} style={{ width: '100%', fontSize: 13, resize: 'vertical' }} />
                                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>Enter 保存，Shift+Enter 换行</div>
                                </div>
                              ) : (
                                item.summary && (
                                  <p onClick={() => { setEditingNews({ catIdx, newsIdx }); setEditSummary(item.summary) }} style={{ fontSize: 13, color: 'var(--text2)', marginTop: 6, lineHeight: 1.5, cursor: 'pointer', borderBottom: '1px dashed transparent' }} onMouseEnter={e => e.currentTarget.style.borderBottomColor = 'var(--text3)'} onMouseLeave={e => e.currentTarget.style.borderBottomColor = 'transparent'} title="点击编辑摘要">
                                    {item.summary}
                                  </p>
                                )
                              )}
                              {item.comment && (
                                <p style={{ fontSize: 12, color: '#7c3aed', marginTop: 6, padding: '6px 10px', background: '#f5f3ff', borderRadius: 6, borderLeft: '3px solid #8b5cf6' }}>
                                  {item.comment}
                                </p>
                              )}
                              {!isEditing && !item.summary && (
                                <button onClick={() => { setEditingNews({ catIdx, newsIdx }); setEditSummary('') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 12, padding: 0, marginTop: 4 }}>
                                  + 添加摘要
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                  {(!draft.categories || draft.categories.length === 0) && (
                    <p style={{ color: 'var(--text3)', fontSize: 14 }}>该草稿暂无新闻内容</p>
                  )}
                </>}
              </div>
            )
          })() : (
            <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text2)' }}>
              <p style={{ fontSize: 14 }}>暂无今日草稿</p>
              <p style={{ fontSize: 12, color: 'var(--text3)' }}>请先运行「抓取新闻」生成草稿</p>
            </div>
          )}
        </div>
      )}

      {/* Tab: Settings */}
      {activeTab === 'settings' && channel && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button onClick={saveSettings} disabled={settingsSaving} style={{ ...btnPrimary, background: 'var(--primary)', color: '#fff' }}>
              {settingsSaving ? '保存中...' : '保存设置'}
            </button>
          </div>
          <div style={card}>
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>频道配置</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <label>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>频道名称</span>
                <input type="text" value={channel.name || ''} onChange={e => updateChannelField('name', e.target.value)} style={{ width: '100%' }} />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>频道描述</span>
                <input type="text" value={channel.description || ''} onChange={e => updateChannelField('description', e.target.value)} placeholder="频道描述（显示在卡片上）" style={{ width: '100%' }} />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>发送时间</span>
                <input type="time" value={`${String(channel.send_hour ?? 10).padStart(2, '0')}:${String(channel.send_minute ?? 0).padStart(2, '0')}`} onChange={e => { const [h, m] = e.target.value.split(':').map(Number); updateChannelField('send_hour', h); updateChannelField('send_minute', m) }} style={{ width: '100%' }} />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>主题模式</span>
                <select value={channel.topic_mode || 'broad'} onChange={e => updateChannelField('topic_mode', e.target.value)} style={{ width: '100%' }}>
                  <option value="broad">泛 AI 模式</option>
                  <option value="focused">聚焦模式</option>
                </select>
              </label>
              <label>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>最大新闻条数</span>
                <input type="number" min={1} max={30} value={channel.max_news_items ?? 10} onChange={e => updateChannelField('max_news_items', parseInt(e.target.value) || 10)} style={{ width: '100%' }} />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>启用</span>
                <select value={channel.enabled ? 'true' : 'false'} onChange={e => updateChannelField('enabled', e.target.value === 'true')} style={{ width: '100%' }}>
                  <option value="true">启用</option>
                  <option value="false">禁用</option>
                </select>
              </label>
              {!isEmail && (
                <>
                  <label>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Key 槽位</span>
                    <select value={channel.webhook_key_slot || ''} onChange={e => updateChannelField('webhook_key_slot', e.target.value ? parseInt(e.target.value) : null)} style={{ width: '100%' }}>
                      <option value="">未设置</option>
                      {[...Array(20)].map((_, i) => <option key={i + 1} value={i + 1}>槽位 {i + 1}</option>)}
                    </select>
                  </label>
                  <label>
                    <span style={{ display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Webhook URL Base（可选）</span>
                    <input type="text" value={channel.webhook_url_base || ''} onChange={e => updateChannelField('webhook_url_base', e.target.value)} placeholder="留空使用全局 URL" style={{ width: '100%' }} />
                  </label>
                </>
              )}
            </div>
          </div>

          {/* Category order */}
          <div style={{ ...card, marginTop: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>分类排序</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(settings?.categories_order || []).map((cat, idx) => (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f9fafb', borderRadius: 6, border: '1px solid var(--border)' }}>
                  <span style={{ flex: 1, fontSize: 14 }}>{cat}</span>
                  <button onClick={() => {
                    if (idx === 0) return
                    const order = [...settings.categories_order]
                    ;[order[idx - 1], order[idx]] = [order[idx], order[idx - 1]]
                    setSettings(prev => ({ ...prev, categories_order: order }))
                  }} disabled={idx === 0} style={{ padding: '2px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>▲</button>
                  <button onClick={() => {
                    const order = [...settings.categories_order]
                    if (idx >= order.length - 1) return
                    ;[order[idx], order[idx + 1]] = [order[idx + 1], order[idx]]
                    setSettings(prev => ({ ...prev, categories_order: order }))
                  }} disabled={idx === (settings?.categories_order || []).length - 1} style={{ padding: '2px 8px', background: 'none', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12, cursor: 'pointer' }}>▼</button>
                </div>
              ))}
            </div>
          </div>

          {/* Filters */}
          <div style={{ ...card, marginTop: 16 }}>
            <h2 style={{ fontSize: 16, marginBottom: 16 }}>过滤规则</h2>
            {['blacklist_keywords', 'blacklist_sources', 'whitelist_keywords', 'whitelist_sources'].map(key => {
              const labels = { blacklist_keywords: '黑名单关键词', blacklist_sources: '黑名单来源', whitelist_keywords: '白名单关键词', whitelist_sources: '白名单来源' }
              const items = settings?.filters?.[key] || []
              return (
                <div key={key} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>{labels[key]}</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input type="text" id={`filter-${key}`} placeholder={`输入${labels[key]}...`} style={{ flex: 1 }} onKeyDown={e => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        const val = e.target.value.trim()
                        if (!items.includes(val)) {
                          setSettings(prev => ({ ...prev, filters: { ...prev.filters, [key]: [...items, val] } }))
                        }
                        e.target.value = ''
                      }
                    }} />
                    <button onClick={() => {
                      const input = document.getElementById(`filter-${key}`)
                      if (input.value.trim() && !items.includes(input.value.trim())) {
                        setSettings(prev => ({ ...prev, filters: { ...prev.filters, [key]: [...items, input.value.trim()] } }))
                        input.value = ''
                      }
                    }} style={{ padding: '6px 16px', background: 'var(--primary-light)', color: 'var(--primary)', border: 'none', borderRadius: 6, fontSize: 13 }}>添加</button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {items.map((item, idx) => (
                      <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#f3f4f6', padding: '4px 10px', borderRadius: 16, fontSize: 12 }}>
                        {item}
                        <button onClick={() => {
                          const updated = [...items]
                          updated.splice(idx, 1)
                          setSettings(prev => ({ ...prev, filters: { ...prev.filters, [key]: updated } }))
                        }} style={{ background: 'none', border: 'none', color: 'var(--text3)', cursor: 'pointer', padding: 0, fontSize: 14 }}>&times;</button>
                      </span>
                    ))}
                    {items.length === 0 && <span style={{ color: 'var(--text3)', fontSize: 12 }}>暂无</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tab: Recipients */}
      {activeTab === 'recipients' && (
        <div>
          {isEmail ? (
            <div style={card}>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>邮件收件人</h2>
              <div style={{ padding: 16, background: '#fffbeb', borderRadius: 8, border: '1px solid #fbbf24', marginBottom: 16 }}>
                <p style={{ fontSize: 14, color: '#92400e', margin: 0 }}>
                  收件人列表存储在 GitHub Secrets 中（<code>EMAIL_RECIPIENTS</code>），以保护邮箱地址隐私。请前往「设置」页面的密钥管理部分进行更新。
                </p>
              </div>
              <a
                href={`https://github.com/${localStorage.getItem('gh_owner') || '{owner}'}/${localStorage.getItem('gh_repo') || '{repo}'}/settings/secrets/actions`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...btnPrimary, background: 'var(--primary-light)', color: 'var(--primary)', textDecoration: 'none', display: 'inline-block' }}
              >
                前往 GitHub Secrets 设置
              </a>
            </div>
          ) : (
            <div style={card}>
              <h2 style={{ fontSize: 16, marginBottom: 12 }}>Webhook 端点</h2>
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Webhook URL Base</div>
                  <div style={{ fontSize: 14, color: 'var(--text2)', padding: '8px 12px', background: '#f9fafb', borderRadius: 6, border: '1px solid var(--border)' }}>
                    {channel.webhook_url_base || settings?.webhook_url_base || 'https://redcity-open.xiaohongshu.com/api/robot/webhook/send'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Key 槽位</div>
                  <div style={{ fontSize: 14, color: 'var(--text2)', padding: '8px 12px', background: '#f9fafb', borderRadius: 6, border: '1px solid var(--border)' }}>
                    {channel.webhook_key_slot ? `槽位 ${channel.webhook_key_slot} (WEBHOOK_KEY_${channel.webhook_key_slot})` : '未设置'}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 16, padding: 12, background: '#f0f9ff', borderRadius: 6, border: '1px solid #bae6fd', fontSize: 13, color: '#0369a1' }}>
                Webhook Key 通过 GitHub Secrets 管理。请前往「设置」页面的密钥管理部分更新 <code>WEBHOOK_KEY_{channel.webhook_key_slot || 'N'}</code>。
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Template */}
      {activeTab === 'template' && (
        <div style={card}>
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>消息模板</h2>
          <div style={{ padding: 16, background: '#f9fafb', borderRadius: 8, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 8 }}>当前模板</div>
            <div style={{
              padding: '2px 10px', borderRadius: 4, fontSize: 13, fontWeight: 500, display: 'inline-block',
              background: isEmail ? '#dbeafe' : '#dcfce7',
              color: isEmail ? '#1d4ed8' : '#166534',
            }}>
              {isEmail ? '邮件 HTML 模板' : 'Webhook Markdown 模板'}
            </div>
            <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 8 }}>
              {isEmail
                ? '使用内置邮件 HTML 模板，支持新闻分类、摘要和链接展示。'
                : '使用内置 Markdown 模板，适配 RedCity Webhook 格式。'}
            </p>
          </div>
          <div style={{ marginTop: 16, padding: 12, background: '#fffbeb', borderRadius: 6, border: '1px solid #fbbf24', fontSize: 13, color: '#92400e' }}>
            自定义模板功能即将推出。当前使用系统内置模板。
          </div>
        </div>
      )}

      {/* Tab: History */}
      {activeTab === 'history' && (
        <div>
          {historyLoading ? (
            <p style={{ color: 'var(--text2)' }}>加载中...</p>
          ) : historyDrafts.length === 0 ? (
            <div style={{ ...card, textAlign: 'center', padding: 40, color: 'var(--text2)' }}>
              <p style={{ fontSize: 16 }}>暂无发送记录</p>
            </div>
          ) : (
            historyDrafts.map(f => {
              const data = historyData[f.name]
              const isExpanded = historyExpanded[f.name]
              const totalNews = data ? (data.categories || []).reduce((n, c) => n + (c.news || []).length, 0) : null
              const dateStr = f.name.replace('.json', '').replace(/_ch_.*/, '')

              return (
                <div key={f.name} style={{ ...card, marginBottom: 12 }}>
                  <div onClick={() => setHistoryExpanded(prev => ({ ...prev, [f.name]: !prev[f.name] }))} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                    <span style={{ fontSize: 14, color: 'var(--text2)' }}>{isExpanded ? '▼' : '▶'}</span>
                    <span style={{ fontWeight: 600, fontSize: 15 }}>{dateStr}</span>
                    {data && (
                      <>
                        {statusBadge(data.status)}
                        <span style={{ fontSize: 12, color: 'var(--text3)' }}>{totalNews} 条新闻</span>
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
                            <div key={newsIdx} style={{ padding: '10px 14px', marginBottom: 6, borderRadius: 6, border: '1px solid var(--border)', background: '#fafafa' }}>
                              <a href={item.url} target="_blank" rel="noopener" style={{ fontWeight: 500, fontSize: 13 }}>{item.title}</a>
                              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{item.source}</div>
                              {item.summary && <p style={{ fontSize: 13, color: 'var(--text2)', marginTop: 6, lineHeight: 1.5 }}>{item.summary}</p>}
                              {item.comment && <p style={{ fontSize: 12, color: '#7c3aed', marginTop: 4, fontStyle: 'italic' }}>{item.comment}</p>}
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
      )}

      {/* Email preview modal */}
      {showEmailPreview && draft && (
        <div onClick={() => setShowEmailPreview(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 700, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid #e5e7eb' }}>
              <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>邮件预览</h3>
              <button onClick={() => setShowEmailPreview(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 20, color: '#6b7280', padding: '0 4px' }}>&times;</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <iframe srcDoc={generateEmailHtml(draft, settings)} style={{ width: '100%', height: '80vh', border: 'none' }} title="Email Preview" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
