import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Review from './pages/Review'
import Settings from './pages/Settings'
import { getStoredAuth } from './lib/auth'
import { configure, isConfigured, getUser } from './lib/github'

export default function App() {
  const [authed, setAuthed] = useState(false)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = getStoredAuth()
    if (stored.token && stored.owner && stored.repo) {
      configure(stored)
      getUser()
        .then((u) => {
          setUser(u)
          setAuthed(true)
        })
        .catch(() => setAuthed(false))
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const onLogin = (u) => {
    setUser(u)
    setAuthed(true)
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--text2)' }}>Loading...</div>
  }

  if (!authed) {
    return <Login onLogin={onLogin} />
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <Sidebar user={user} />
      <main style={{ flex: 1, padding: '24px 32px', maxWidth: 960, margin: '0 auto' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/review" element={<Review />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
