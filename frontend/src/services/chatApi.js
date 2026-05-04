import api from './api.js'
 
export const chatApi = {
  list:         ()          => api.get('/chat'),
  get:          (id)        => api.get(`/chat/${id}`),
  create:       (data)      => api.post('/chat', data),
  update:       (id, data)  => api.patch(`/chat/${id}`, data),
  delete:       (id)        => api.delete(`/chat/${id}`),
  clearMsgs:    (id)        => api.delete(`/chat/${id}/messages`),
  getMemory:    (id)        => api.get(`/chat/${id}/memory`),
}
 
 
// ── src/hooks/useWebSocket.js ─────────────────────────────────
import { useRef, useCallback, useEffect } from 'react'
 
const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:5000/ws'
 
export function useWebSocket() {
  const wsRef        = useRef(null)
  const callbacksRef = useRef({})
  const reconnectRef = useRef(null)
  const connectingRef = useRef(false)
 
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (connectingRef.current) return
    connectingRef.current = true
 
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws
 
    ws.onopen = () => {
      connectingRef.current = false
      // Authenticate immediately
      const token = localStorage.getItem('dm_access')
      ws.send(JSON.stringify({ type: 'auth', token }))
    }
 
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        callbacksRef.current[msg.type]?.(msg)
      } catch {}
    }
 
    ws.onclose = (e) => {
      connectingRef.current = false
      if (e.code !== 4001) { // not unauthorized
        reconnectRef.current = setTimeout(connect, 3000)
      }
    }
 
    ws.onerror = () => { connectingRef.current = false }
  }, [])
 
  const disconnect = useCallback(() => {
    clearTimeout(reconnectRef.current)
    wsRef.current?.close()
    wsRef.current = null
  }, [])
 
  const sendMessage = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])
 
  const on = useCallback((type, cb) => {
    callbacksRef.current[type] = cb
  }, [])
 
  useEffect(() => {
    connect()
    return disconnect
  }, [connect, disconnect])
 
  return { sendMessage, on, connect, disconnect, ws: wsRef }
}