const CATEGORY_ICONS = {
  // 聚焦模式 3 分类
  '智能硬件': '🥽', 'AI技术与产品': '🤖', '巨头动向与行业观察': '🏢',
  // 泛 AI 模式 5 分类
  '产品发布': '🚀', '巨头动向': '🏢', '技术进展': '🔬',
  '行业观察': '📊', '投融资': '💰',
}

export function generateEmailHtml(draft, settings) {
  const date = draft.date || ''
  const timeWindow = draft.time_window || ''
  const rawCategories = draft.categories || []

  // 直接按草稿中的分类顺序显示（聚焦模式的顺序由 Claude 返回）
  let sectionsHtml = ''
  let hasNews = false

  for (const cat of rawCategories) {
    const catName = cat.name || ''
    const newsItems = cat.news || []
    if (newsItems.length === 0) continue
    hasNews = true
    const icon = CATEGORY_ICONS[catName] || cat.icon || '📰'

    let cardsHtml = ''
    for (const item of newsItems) {
      const title = escapeHtml(item.title || '')
      const summary = escapeHtml(item.summary || '')
      const comment = escapeHtml(item.comment || '')
      const source = escapeHtml(item.source || '')
      const url = escapeHtml(item.url || '#')

      const commentHtml = comment
        ? `<p style="color:#7c3aed;font-size:13px;line-height:1.5;margin:8px 0 10px 0;padding:8px 12px;background:#f5f3ff;border-radius:6px;">🤔 ${comment}</p>`
        : ''

      cardsHtml += `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
<tr><td style="background:#ffffff;border-radius:8px;border:1px solid #e8e8e8;padding:16px 20px;">
  <a href="${url}" style="color:#1a1a2e;text-decoration:none;font-size:15px;font-weight:600;line-height:1.4;display:block;" target="_blank">${title}</a>
  <p style="color:#555;font-size:14px;line-height:1.6;margin:8px 0 10px 0;">${summary}</p>
  ${commentHtml}
  <span style="display:inline-block;background:#eef2ff;color:#4f46e5;font-size:12px;padding:2px 10px;border-radius:12px;">${source}</span>
</td></tr>
</table>`
    }

    sectionsHtml += `<tr><td style="padding:24px 30px 8px 30px;">
  <h2 style="margin:0 0 16px 0;font-size:18px;color:#1a1a2e;font-weight:700;">${icon} ${escapeHtml(catName)}</h2>
  ${cardsHtml}
</td></tr>`
  }

  if (!hasNews) {
    sectionsHtml = '<tr><td style="padding:20px 30px;color:#666;font-size:16px;">今日暂无重要新闻。</td></tr>'
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f0f2f5;">
<tr><td align="center" style="padding:24px 16px;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

<!-- Header -->
<tr><td style="background-color:#1a1a2e;background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:32px 30px;text-align:center;">
  <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;letter-spacing:1px;">AI / 科技新闻日报</h1>
  <p style="margin:10px 0 0 0;color:rgba(255,255,255,0.75);font-size:14px;">${escapeHtml(date)} &nbsp;|&nbsp; ${escapeHtml(timeWindow)}</p>
</td></tr>

<!-- News Sections -->
${sectionsHtml}

<!-- Footer -->
<tr><td style="padding:20px 30px;border-top:1px solid #eee;text-align:center;">
  <p style="margin:0;color:#999;font-size:12px;">由 AI News Assistant 自动生成 &nbsp;&middot;&nbsp; Powered by Claude</p>
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
