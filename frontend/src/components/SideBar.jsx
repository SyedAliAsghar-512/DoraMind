import React, { useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'

export default function Sidebar({
  open, chats, activeChatId, user,
  onNewChat, onSelectChat, onDeleteChat, onRenameChat,
  onToggle,
}) {
  const { logout } = useAuth()
  const [editId, setEditId] = useState(null)
  const [editTitle, setEditTitle] = useState('')

  const grouped = groupByDate(chats)

  const startRename = (e, chat) => {
    e.stopPropagation()
    setEditId(chat.id)
    setEditTitle(chat.title)
  }

  const commitRename = (id) => {
    if (editTitle.trim()) onRenameChat(id, editTitle.trim())
    setEditId(null)
  }

  // Fallback avatar logic
  const initials = user?.name ? user.name.charAt(0).toUpperCase() : 'U';

  return (
    <aside className={`sidebar ${open ? 'open' : 'closed'}`}>
      <div className="sidebar-header">
        <button className="sidebar-hamburger" onClick={onToggle} title="Toggle sidebar">
           <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>
        {open && (
           <button className="new-chat-icon-btn" onClick={onNewChat} title="New Chat">
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
           </button>
        )}
      </div>

      {open && (
        <>
          <div className="chat-list">
            {Object.entries(grouped).map(([group, items]) => (
              <div key={group} className="chat-group">
                <div className="chat-group-label">{group}</div>
                {items.map(chat => (
                  <div
                    key={chat.id}
                    className={`chat-item ${chat.id === activeChatId ? 'active' : ''}`}
                    onClick={() => onSelectChat(chat.id)}
                  >
                    {editId === chat.id ? (
                      <input
                        className="rename-input"
                        value={editTitle}
                        autoFocus
                        onChange={e => setEditTitle(e.target.value)}
                        onBlur={() => commitRename(chat.id)}
                        onKeyDown={e => { if (e.key === 'Enter') commitRename(chat.id) }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span className="chat-item-title">{chat.title}</span>
                        <div className="chat-item-actions" onClick={e => e.stopPropagation()}>
                          <button title="Rename" onClick={e => startRename(e, chat)}>✎</button>
                          <button title="Delete" onClick={() => onDeleteChat(chat.id)}>✕</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
          
          <div className="sidebar-footer">
            <div className="user-info">
              {user?.avatar ? (
                <img src={user.avatar} alt="" className="user-avatar" />
              ) : (
                <div className="user-avatar-fallback">{initials}</div>
              )}
              <div className="user-details">
                <span className="user-name">{user?.name}</span>
              </div>
            </div>
            <button className="logout-btn" onClick={logout} title="Sign out">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            </button>
          </div>
        </>
      )}
    </aside>
  )
}

function groupByDate(chats) {
  const now = new Date()
  const groups = { Today: [], Yesterday: [], 'Previous 7 Days': [], Older: [] }
  for (const c of chats) {
    const d = new Date(c.lastAt)
    const diff = Math.floor((now - d) / 86400000)
    if (diff === 0)      groups.Today.push(c)
    else if (diff === 1) groups.Yesterday.push(c)
    else if (diff < 7)   groups['Previous 7 Days'].push(c)
    else                 groups.Older.push(c)
  }
  return Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length > 0))
}