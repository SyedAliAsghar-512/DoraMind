import React, { useEffect, useRef } from 'react'
import MessageBubble from './MessageBubble.jsx'
import ChatInput from './ChatInput.jsx'

export default function ChatWindow({
  messages,
  streaming,
  streamBuffer,
  loading,
  activeChat,
  connected,
  activeModel,
  model,
  setModel,
  onSend,
  onAbort
}) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, streamBuffer])

  const handleShare = () => {
    const transcript = messages.map(m => `${m.role === 'user' ? 'You' : 'AI'}: ${m.content}`).join('\n\n');
    navigator.clipboard.writeText(transcript);
    alert('Chat transcript copied to clipboard!');
  }

  return (
    <div className="chat-window">
      <div className="chat-header">
        <div className="chat-header-title">{activeChat?.title || 'Chat'}</div>
        <div className="chat-header-meta">
           <button className="share-btn" onClick={handleShare} title="Copy Transcript">
             <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
             Share
           </button>
        </div>
      </div>

      <div className="messages-container">
        <div className="messages-inner">
          {loading && (
            <div className="loading-msgs">
              <div className="spinner" />
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={msg._id || i} message={msg} />
          ))}

          {streaming && streamBuffer && (
            <MessageBubble
              message={{ role: 'assistant', content: streamBuffer, model: activeModel }}
              isStreaming
            />
          )}

          {streaming && !streamBuffer && (
            <MessageBubble
              message={{ role: 'assistant', content: '', model: activeModel }}
              isStreaming
              isThinking
            />
          )}
          <div ref={bottomRef} style={{ height: '40px' }} />
        </div>
      </div>
      
      <ChatInput
        onSend={onSend}
        onAbort={onAbort}
        streaming={streaming}
        disabled={loading}
        model={model}
        setModel={setModel}
      />
    </div>
  )
}