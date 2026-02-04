import React from 'react'

const card = {
  background: 'var(--card)', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', padding: 24, boxShadow: 'var(--shadow)',
  marginBottom: 20,
}

const codeBlock = {
  background: '#1e1e1e',
  color: '#d4d4d4',
  padding: '16px 20px',
  borderRadius: 8,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 13,
  lineHeight: 1.6,
  overflowX: 'auto',
}

const stepNumber = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  borderRadius: '50%',
  background: 'var(--primary)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  marginRight: 10,
}

export default function Recipients() {
  return (
    <div>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>收件人管理</h1>
      <p style={{ color: 'var(--text2)', marginBottom: 24, fontSize: 14 }}>
        收件人配置存储在 GitHub Secrets 中，以保护邮箱地址隐私
      </p>

      {/* Why */}
      <div style={{ ...card, background: '#fffbeb', borderColor: '#fbbf24' }}>
        <h2 style={{ fontSize: 15, marginBottom: 8, color: '#b45309' }}>
          为什么不能直接在 UI 上修改？
        </h2>
        <p style={{ fontSize: 14, color: '#92400e', lineHeight: 1.6, margin: 0 }}>
          由于本项目是<strong>公开仓库</strong>，存储在代码中的邮箱地址会被公开可见。
          为保护隐私，收件人列表存储在 GitHub Secrets 中。Secrets 是加密的，只有 GitHub Actions 运行时可以读取，
          无法被外部访问，也无法在 UI 中回显（只写不可读）。
        </p>
      </div>

      {/* How to modify */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 16 }}>如何修改收件人</h2>

        <div style={{ marginBottom: 20 }}>
          <p style={{ marginBottom: 8 }}>
            <span style={stepNumber}>1</span>
            <span style={{ fontWeight: 500 }}>打开仓库的 Secrets 设置页面</span>
          </p>
          <p style={{ fontSize: 14, color: 'var(--text2)', marginLeft: 34, marginBottom: 12 }}>
            进入你的 GitHub 仓库 → <strong>Settings</strong> → <strong>Secrets and variables</strong> → <strong>Actions</strong>
          </p>
          <a
            href={`https://github.com/${localStorage.getItem('gh_owner') || '{owner}'}/${localStorage.getItem('gh_repo') || '{repo}'}/settings/secrets/actions`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              marginLeft: 34,
              padding: '8px 16px',
              background: 'var(--primary-light)',
              color: 'var(--primary)',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
            }}
          >
            前往 Secrets 设置 →
          </a>
        </div>

        <div style={{ marginBottom: 20 }}>
          <p style={{ marginBottom: 8 }}>
            <span style={stepNumber}>2</span>
            <span style={{ fontWeight: 500 }}>添加或更新 <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>EMAIL_RECIPIENTS</code> Secret</span>
          </p>
          <p style={{ fontSize: 14, color: 'var(--text2)', marginLeft: 34, marginBottom: 12 }}>
            点击 <strong>New repository secret</strong>（或点击已有的 EMAIL_RECIPIENTS 进行更新）
          </p>
        </div>

        <div style={{ marginBottom: 20 }}>
          <p style={{ marginBottom: 8 }}>
            <span style={stepNumber}>3</span>
            <span style={{ fontWeight: 500 }}>填写收件人邮箱</span>
          </p>
          <p style={{ fontSize: 14, color: 'var(--text2)', marginLeft: 34, marginBottom: 12 }}>
            Name 填 <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>EMAIL_RECIPIENTS</code>，Value 填邮箱地址，多个邮箱用英文逗号分隔：
          </p>
          <div style={{ marginLeft: 34 }}>
            <pre style={codeBlock}>user1@example.com,user2@example.com,user3@example.com</pre>
          </div>
        </div>

        <div>
          <p style={{ marginBottom: 8 }}>
            <span style={stepNumber}>4</span>
            <span style={{ fontWeight: 500 }}>点击 Add secret 保存</span>
          </p>
          <p style={{ fontSize: 14, color: 'var(--text2)', marginLeft: 34 }}>
            保存后立即生效，下次发送邮件时会使用新的收件人列表。
          </p>
        </div>
      </div>

      {/* Current status */}
      <div style={card}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>当前状态</h2>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          background: '#f0fdf4',
          borderRadius: 8,
          border: '1px solid #86efac',
        }}>
          <span style={{ fontSize: 18 }}>🔒</span>
          <div>
            <p style={{ fontWeight: 500, fontSize: 14, margin: 0 }}>收件人已通过 Secrets 保护</p>
            <p style={{ fontSize: 13, color: 'var(--text2)', margin: '4px 0 0 0' }}>
              邮箱地址不会出现在公开代码中，仅 GitHub Actions 运行时可访问
            </p>
          </div>
        </div>
      </div>

      {/* Tips */}
      <div style={{ ...card, background: '#f0f9ff', borderColor: '#7dd3fc' }}>
        <h2 style={{ fontSize: 15, marginBottom: 8, color: '#0369a1' }}>提示</h2>
        <ul style={{ fontSize: 14, color: '#0c4a6e', lineHeight: 1.8, margin: 0, paddingLeft: 20 }}>
          <li>Secrets 是<strong>只写</strong>的，设置后无法查看原值，只能覆盖更新</li>
          <li>如需查看当前收件人，建议自己维护一份记录</li>
          <li>修改后无需重新部署，下次工作流运行时自动生效</li>
        </ul>
      </div>
    </div>
  )
}
