import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../services/api.js'
 
const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)
 
export function AuthProvider({ children }) {
  const [user, setUser]     = useState(null)
  const [loading, setLoading] = useState(true)
 
  useEffect(() => {
    const token = localStorage.getItem('dm_access')
    if (!token) { setLoading(false); return }
    api.get('/auth/me')
      .then(r => setUser(r.data.user))
      .catch(() => { localStorage.clear() })
      .finally(() => setLoading(false))
  }, [])
 
  // GOOGLE login (existing)
  const login = useCallback(async (idToken) => {
    const { data } = await api.post('/auth/google', { idToken })
    localStorage.setItem('dm_access',  data.accessToken)
    localStorage.setItem('dm_refresh', data.refreshToken)
    setUser(data.user)
    return data
  }, [])

  // MANUAL login
  const manualLogin = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    localStorage.setItem('dm_access',  data.accessToken)
    localStorage.setItem('dm_refresh', data.refreshToken)
    setUser(data.user)
    return data
  }, [])

  // MANUAL registration
  const register = useCallback(async (name, email, password) => {
    const { data } = await api.post('/auth/register', { name, email, password })
    localStorage.setItem('dm_access',  data.accessToken)
    localStorage.setItem('dm_refresh', data.refreshToken)
    setUser(data.user)
    return data
  }, [])
 
  const logout = useCallback(() => {
    localStorage.clear()
    setUser(null)
  }, [])
 
  const updatePreferences = useCallback(async (prefs) => {
    const { data } = await api.patch('/auth/preferences', prefs)
    setUser(data.user)
  }, [])
 
  return (
    <AuthCtx.Provider value={{
      user, loading, login, logout, updatePreferences,
      manualLogin, register, // <-- Add these to context
    }}>
      {children}
    </AuthCtx.Provider>
  )
}