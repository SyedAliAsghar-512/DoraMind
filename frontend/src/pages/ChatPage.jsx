import React, { useState, useEffect, useCallback } from 'react'
import Sidebar     from '../components/SideBar.jsx'
import ChatWindow  from '../components/ChatWindow.jsx'
import Welcome     from '../components/Welcome.jsx'
import { chatApi } from '../services/chatApi.js'
import { useAuth }  from '../contexts/AuthContext.jsx'
import { useChat }  from '../hooks/useChat.js'
import { useWebSocket } from '../hooks/useWebSocket.js'

export default function ChatPage() {
  const { user }     = useAuth()
  const [chats,      setChats]       = useState([])
  const [activeChat, setActiveChat]  = useState(null)
  const [messages,   setMessages]    = useState([])
  const [chatId,     setChatId]      = useState(null)
  const [model,      setModel]       = useState('mistral')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [loading,    setLoading]     = useState(false)

  const { connected } = useWebSocket()

  const handleMessageComplete = useCallback(async () => {
    try {
      // Reload chat to get persisted assistant message
      if (chatId) {
        const { data } = await chatApi.get(chatId)
        setMessages(data.chat.messages || [])
        setActiveChat(data.chat)
      }
      await loadChats()
    } catch { /* non-fatal */ }
  }, [chatId])

  const {
    sendMessage: wsSend,
    abort,
    streaming,
    streamBuffer,
    activeModel,
  } = useChat({ chatId, onMessageComplete: handleMessageComplete })

  const loadChats = useCallback(async () => {
    try {
      const { data } = await chatApi.list()
      setChats(data.chats)
    } catch {}
  }, [])

  useEffect(() => { loadChats() }, [loadChats])

  useEffect(() => {
    if (!chatId) {
      setActiveChat(null)
      setMessages([])
      return
    }
    setLoading(true)
    setMessages([])
    chatApi.get(chatId)
      .then(({ data }) => {
        setActiveChat(data.chat)
        setMessages(data.chat.messages || [])
        setModel(data.chat.model || 'mistral')
      })
      .catch(() => setChatId(null))
      .finally(() => setLoading(false))
  }, [chatId])

  const handleNewChatClick = useCallback(() => {
    setChatId(null)
  }, [])

  const deleteChat = useCallback(async (id) => {
    try {
      await chatApi.delete(id)
      await loadChats()
      if (id === chatId) setChatId(null)
    } catch {}
  }, [chatId, loadChats])

  const renameChat = useCallback(async (id, title) => {
    try {
      await chatApi.update(id, { title })
      await loadChats()
      if (id === chatId) setActiveChat(prev => ({ ...prev, title }))
    } catch {}
  }, [chatId, loadChats])

  const sendMessage = useCallback(async (content, attachedDocs = []) => {
    if (!content?.trim() || streaming) return

    const docIds = attachedDocs.map(d => d._id)
    let targetChatId = chatId

    // Create chat first if new
    if (!targetChatId) {
      try {
        const res = await chatApi.create({
          model,
          title: content.substring(0, 60),
          documentIds: docIds,
        })
        targetChatId = res.data.chat._id
        setChatId(targetChatId)
        await loadChats()
      } catch (err) {
        console.error('Failed to create chat:', err)
        return
      }
    } else if (docIds.length > 0) {
      try {
        const existing = (activeChat?.documentIds || []).map(d => d._id || d)
        await chatApi.update(targetChatId, { documentIds: [...existing, ...docIds] })
      } catch {}
    }

    // Optimistic user message
    const tmpMsg = {
      _id: `tmp-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, tmpMsg])

    // Send via WebSocket
    wsSend(content, model, targetChatId)
  }, [chatId, streaming, model, wsSend, activeChat, loadChats])

  const displayModel = activeModel || model

  return (
    <div className="chat-page">
      <Sidebar
        open={sidebarOpen}
        chats={chats}
        activeChatId={chatId}
        user={user}
        onNewChat={handleNewChatClick}
        onSelectChat={id => setChatId(id)}
        onDeleteChat={deleteChat}
        onRenameChat={renameChat}
        onToggle={() => setSidebarOpen(o => !o)}
      />

      <div className="chat-main">
        {/* Floating toggle when sidebar is closed */}
        {!sidebarOpen && (
          <button
            className="sidebar-toggle-float"
            onClick={() => setSidebarOpen(true)}
            title="Open sidebar"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="6"  x2="21" y2="6"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
        )}

        {!chatId ? (
          <Welcome
            user={user}
            model={model}
            setModel={setModel}
            onSend={sendMessage}
            streaming={streaming}
          />
        ) : (
          <ChatWindow
            messages={messages}
            streaming={streaming}
            streamBuffer={streamBuffer}
            loading={loading}
            activeChat={activeChat}
            connected={connected}
            activeModel={displayModel}
            model={model}
            setModel={setModel}
            onSend={sendMessage}
            onAbort={abort}
          />
        )}
      </div>
    </div>
  )
}