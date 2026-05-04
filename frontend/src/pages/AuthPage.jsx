import React, { useEffect, useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'

export default function AuthPage() {
  const { user, login, manualLogin, register } = useAuth()
  const navigate = useNavigate()
  const [tab, setTab] = useState('login')

  const [loginEmail, setLoginEmail]   = useState('')
  const [loginPass,  setLoginPass]    = useState('')
  const [regName,    setRegName]      = useState('')
  const [regEmail,   setRegEmail]     = useState('')
  const [regPass,    setRegPass]      = useState('')
  const [error,      setError]        = useState('')
  const [loading,    setLoading]      = useState(false)

  useEffect(() => {
    if (user) navigate('/chat', { replace: true })
  }, [user, navigate])

  const handleManualLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await manualLogin(loginEmail, loginPass)
      navigate('/chat', { replace: true })
    } catch (err) {
      setError(err?.response?.data?.error || 'Invalid email or password')
    } finally {
      setLoading(false)
    }
  }

  const handleRegister = async (e) => {
    e.preventDefault()
    setError('')
    if (regPass.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    setLoading(true)
    try {
      await register(regName, regEmail, regPass)
      navigate('/chat', { replace: true })
    } catch (err) {
      setError(err?.response?.data?.error || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async (credentialResponse) => {
    setError('')
    try {
      await login(credentialResponse.credential)
      navigate('/chat', { replace: true })
    } catch {
      setError('Google sign-in failed. Please try again.')
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        {/* Logo */}
        <div className="auth-logo">
          <span className="logo-text">DoraMind</span>
          <span className="logo-badge">AI</span>
        </div>

        <h1 className="auth-title">
          {tab === 'login' ? 'Welcome back' : 'Create your account'}
        </h1>
        <p className="auth-subtitle">
          {tab === 'login'
            ? 'Sign in to continue to your AI assistant'
            : 'Start chatting with your self-hosted AI'}
        </p>

        {/* Tabs */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === 'login' ? 'active' : ''}`}
            onClick={() => { setTab('login'); setError('') }}
          >
            Sign In
          </button>
          <button
            className={`auth-tab ${tab === 'register' ? 'active' : ''}`}
            onClick={() => { setTab('register'); setError('') }}
          >
            Register
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="auth-error">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            {error}
          </div>
        )}

        {/* Login Form */}
        {tab === 'login' && (
          <form onSubmit={handleManualLogin} className="auth-form">
            <input
              type="email"
              required
              placeholder="Email address"
              value={loginEmail}
              onChange={e => setLoginEmail(e.target.value)}
              autoComplete="username"
              autoFocus
            />
            <input
              type="password"
              required
              placeholder="Password"
              value={loginPass}
              onChange={e => setLoginPass(e.target.value)}
              autoComplete="current-password"
            />
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        )}

        {/* Register Form */}
        {tab === 'register' && (
          <form onSubmit={handleRegister} className="auth-form">
            <input
              type="text"
              required
              placeholder="Your full name"
              value={regName}
              onChange={e => setRegName(e.target.value)}
              autoComplete="name"
              autoFocus
            />
            <input
              type="email"
              required
              placeholder="Email address"
              value={regEmail}
              onChange={e => setRegEmail(e.target.value)}
              autoComplete="username"
            />
            <input
              type="password"
              required
              placeholder="Password (min. 6 characters)"
              value={regPass}
              onChange={e => setRegPass(e.target.value)}
              autoComplete="new-password"
            />
            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>
        )}

        {/* Divider */}
        <div className="auth-divider">or continue with</div>

        {/* Google */}
        <div className="auth-google-wrapper">
          <GoogleLogin
            onSuccess={handleGoogle}
            onError={() => setError('Google sign-in failed')}
            theme="filled_black"
            shape="pill"
            size="large"
            text="continue_with"
          />
        </div>

        {/* Features */}
        <div className="auth-features">
          {[
            'Multi-model AI (Mistral, LLaMA, Qwen)',
            'Persistent memory — remembers you',
            'Document & image understanding (RAG)',
            'Real-time streaming responses',
            'Fully self-hosted, your data stays local',
          ].map(f => (
            <div key={f} className="auth-feature">
              <span className="feature-dot" />
              <span>{f}</span>
            </div>
          ))}
        </div>

        <p className="auth-note">
          No external API costs. Everything runs on your hardware.
        </p>
      </div>
    </div>
  )
}