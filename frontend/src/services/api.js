import axios from 'axios'
 
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api',
  timeout: 30000,
})
 
// Attach access token to every request
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('dm_access')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})
 
// Auto-refresh on 401
api.interceptors.response.use(
  r => r,
  async err => {
    const original = err.config
    if (err.response?.status === 401 && err.response?.data?.code === 'TOKEN_EXPIRED' && !original._retry) {
      original._retry = true
      const refresh = localStorage.getItem('dm_refresh')
      if (!refresh) { localStorage.clear(); window.location = '/auth'; return Promise.reject(err) }
      try {
        const { data } = await axios.post(
          `${original.baseURL || ''}/auth/refresh`,
          { refreshToken: refresh }
        )
        localStorage.setItem('dm_access', data.accessToken)
        original.headers.Authorization = `Bearer ${data.accessToken}`
        return api(original)
      } catch {
        localStorage.clear()
        window.location = '/auth'
      }
    }
    return Promise.reject(err)
  }
)
 
export default api