import React from 'react'
import ChatInput from './ChatInput'

export default function Welcome({ user, model, setModel, onSend, streaming }) {
  return (
    <div className="welcome-wrapper">
      <div className="welcome-content">
        <h2 className="welcome-greeting">
          Good to see you, {user?.name || 'there'}
        </h2>
        <p className="welcome-sub">
          How can I help you today?
        </p>
      </div>
      <div className="welcome-input-container">
        <ChatInput 
          onSend={onSend} 
          streaming={streaming} 
          model={model} 
          setModel={setModel} 
          disabled={false}
          isCentered={true}
        />
      </div>
    </div>
  )
}