import React from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { clearAuth } from '../lib/auth'
import { getStoredAuth } from '../lib/auth'

const navItems = [
  { to: '/', label: '仪表盘', icon: '📊' },
  { to: '/sources', label: '新闻源管理', icon: '📡' },
  { to: '/recipients', label: '收件人管理', icon: '📬' },
  { to: '/settings', label: '设置', icon: '⚙️' },
  { to: '/history', label: '发送历史', icon: '📋' },
  { to: '/secrets', label: '密钥管理', icon: '🔑' },
]

const linkStyle = (isActive) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 16px',
  borderRadius: 8,
  color: isActive ? 'var(--primary)' : 'var(--text)',
  background: isActive ? 'var(--primary-light)' : 'transparent',
  fontWeight: isActive ? 600 : 400,
  textDecoration: 'none',
  transition: 'background .15s',
})

export default function Sidebar({ user }) {
  const navigate = useNavigate()
  const stored = getStoredAuth()

  const logout = () => {
    clearAuth()
    window.location.reload()
  }

  const wikiUrl = stored.owner && stored.repo
    ? `https://github.com/${stored.owner}/${stored.repo}/wiki`
    : 'https://github.com'

  return (
    <aside style={{
      width: 220,
      background: 'var(--card)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      padding: '20px 12px',
    }}>
      <div style={{ fontWeight: 700, fontSize: 16, padding: '0 8px 20px', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        📰 News Admin
      </div>

      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {navItems.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} style={({ isActive }) => linkStyle(isActive)}>
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </NavLink>
        ))}

        <div style={{ marginTop: 12, padding: '0 16px' }}>
          <a
            href={wikiUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text2)', fontSize: 14, padding: '8px 0' }}
          >
            📖 Wiki 文档
          </a>
        </div>
      </nav>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        {user && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 8px', marginBottom: 8 }}>
            <img src={user.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />
            <span style={{ fontSize: 13, color: 'var(--text2)' }}>{user.login}</span>
          </div>
        )}
        <button
          onClick={logout}
          style={{ width: '100%', padding: '8px 16px', background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text2)', fontSize: 13 }}
        >
          退出登录
        </button>
      </div>
    </aside>
  )
}
