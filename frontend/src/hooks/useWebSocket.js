import { useRef, useCallback, useEffect, useState } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:5000/ws'

/**
 * Singleton-style WebSocket hook.
 * One connection per app session, auto-reconnects, handles auth.
 */
export function useWebSocket() {
  const wsRef         = useRef(null)
  const handlersRef   = useRef({})      // type -> callback
  const reconnTimerRef = useRef(null)
  const intentionalClose = useRef(false)
  const [connected, setConnected] = useState(false)

  const emit = useCallback((type, data) => {
    const cb = handlersRef.current[type]
    if (cb) cb(data)
  }, [])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return

    intentionalClose.current = false
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      const token = localStorage.getItem('dm_access')
      ws.send(JSON.stringify({ type: 'auth', token }))
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'auth_ok') setConnected(true)
        emit(msg.type, msg)
      } catch { /* ignore parse errors */ }
    }

    ws.onclose = (ev) => {
      setConnected(false)
      if (!intentionalClose.current && ev.code !== 4001) {
        // Exponential back-off would be better in production
        reconnTimerRef.current = setTimeout(connect, 3000)
      }
    }

    ws.onerror = () => {
      // onclose fires right after, so reconnect logic handled there
    }
  }, [emit])

  const disconnect = useCallback(() => {
    intentionalClose.current = true
    clearTimeout(reconnTimerRef.current)
    wsRef.current?.close()
    wsRef.current = null
    setConnected(false)
  }, [])

  // Register an event handler (latest callback wins — no stale closures)
  const on = useCallback((type, cb) => {
    handlersRef.current[type] = cb
  }, [])

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
      return true
    }
    return false
  }, [])

  useEffect(() => {
    connect()
    return disconnect
  }, [connect, disconnect])

  return { send, on, connected, connect, disconnect, wsRef }
}