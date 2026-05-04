import { useState, useCallback, useRef, useEffect } from 'react'
import { useWebSocket } from './useWebSocket.js'

export function useChat({ chatId, onMessageComplete }) {
  const [streaming,    setStreaming]    = useState(false)
  const [streamBuffer, setStreamBuffer] = useState('')
  const [activeModel,  setActiveModel]  = useState(null)

  const bufferRef   = useRef('')
  const abortedRef  = useRef(false)

  const { send, on, connected } = useWebSocket()

  useEffect(() => {
    on('stream_start', (msg) => {
      bufferRef.current  = ''
      abortedRef.current = false
      setActiveModel(msg.model)
      setStreamBuffer('')
      setStreaming(true)
    })

    on('stream_delta', (msg) => {
      bufferRef.current += msg.delta
      setStreamBuffer(prev => prev + msg.delta)
    })

    on('stream_end', async (msg) => {
      setStreaming(false)
      const finalContent = bufferRef.current
      bufferRef.current  = ''
      setStreamBuffer('')
      if (!abortedRef.current) {
        onMessageComplete?.(finalContent, msg)
      }
    })

    on('aborted', () => {
      setStreaming(false)
      bufferRef.current  = ''
      setStreamBuffer('')
    })

    on('error', (msg) => {
      console.error('[Chat WS Error]', msg.message)
      setStreaming(false)
      bufferRef.current  = ''
      setStreamBuffer('')
    })
  })

  // Accept overrideChatId to handle the "first message" scenario seamlessly
  const sendMessage = useCallback((content, model, overrideChatId = null) => {
    const targetId = overrideChatId || chatId;
    if (!targetId || !content?.trim() || streaming) return false
    abortedRef.current = false
    const sent = send({ type: 'chat', chatId: targetId, content: content.trim(), model })
    if (!sent) {
      console.warn('[useChat] WS not open — message dropped')
    }
    return sent
  }, [chatId, streaming, send])

  const abort = useCallback(() => {
    abortedRef.current = true
    send({ type: 'abort' })
    setStreaming(false)
    setStreamBuffer('')
    bufferRef.current = ''
  }, [send])

  return {
    sendMessage,
    abort,
    streaming,
    streamBuffer,
    activeModel,
    connected,
  }
}