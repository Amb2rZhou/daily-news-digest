import React, { useState } from 'react'
import { saveAuth } from '../lib/auth'
import { configure, getUser } from '../lib/github'

export default function Login({ onLogin }) {
  const [token, setToken] = useState('')
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      configure({ token, owner, repo })
      const user = await getUser()
      // Verify that the token can access the repo (works for both personal and org repos)
      const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: { Authorization: `token ${token}` },
      })
      if (!repoRes.ok) {
        setError(`无法访问仓库 ${owner}/${repo}，请检查 Owner、Repo 和 Token 权限`)
        setLoading(false)
        return
      }
      saveAuth({ token, owner, repo })
      onLogin(user)
    } catch {
      setError('认证失败，请检查 Token 是否正确')
    }
    setLoading(false)
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--bg)',
    }}>
      <form onSubmit={handleSubmit} style={{
        background: 'var(--card)', padding: 40, borderRadius: 12,
        boxShadow: 'var(--shadow)', width: 400, maxWidth: '90vw',
      }}>
        <h1 style={{ fontSize: 22, marginBottom: 8, textAlign: 'center' }}>📰 News Digest Admin</h1>
        <p style={{ color: 'var(--text2)', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
          使用 GitHub Personal Access Token 登录
        </p>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>GitHub Owner</span>
          <input
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="e.g. your-username"
            required
            style={{ width: '100%' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 16 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Repository Name</span>
          <input
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="e.g. daily-news-digest"
            required
            style={{ width: '100%' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 24 }}>
          <span style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Personal Access Token</span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_..."
            required
            style={{ width: '100%' }}
          />
          <span style={{ display: 'block', fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
            需要 repo 和 workflow 权限
          </span>
        </label>

        {error && (
          <div style={{ background: '#fef2f2', color: 'var(--danger)', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '10px 0',
            background: 'var(--primary)', color: '#fff',
            border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 15,
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '验证中...' : '登录'}
        </button>
      </form>
    </div>
  )
}
