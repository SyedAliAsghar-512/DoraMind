import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import remarkGfm from 'remark-gfm'

export default function MessageBubble({ message, isStreaming, isThinking }) {
  const isUser = message.role === 'user'
  const ts = message.timestamp
    ? new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : ''
  return (
    <div className={`message-bubble ${isUser ? 'user' : 'assistant'} ${isStreaming ? 'streaming' : ''}`}>
      {!isUser && (
        <div className="msg-avatar">
          <span>AI</span>
        </div>
      )}
      <div className="msg-body">
        <div className="msg-content">
          {isThinking ? (
            <span className="thinking-indicator">
              <span /><span /><span />
            </span>
          ) : isUser ? (
            <p className="user-text">{message.content}</p>
          ) : (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ node, inline, className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '')
                  return !inline && match ? (
                    <CodeBlock language={match[1]} code={String(children).replace(/\n$/, '')} />
                  ) : (
                    <code className="inline-code" {...props}>{children}</code>
                  )
                },
                table: ({ children }) => (
                  <div className="table-wrapper"><table>{children}</table></div>
                ),
                a: ({ href, children }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
                ),
              }}
            >
              {message.content}
            </ReactMarkdown>
          )}
        </div>

      </div>
      {isUser && (
        <div className="msg-avatar user-avatar-icon">
          <span>You</span>
        </div>
      )}
    </div>
  )
}

function CodeBlock({ language, code }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="code-block">
      <div className="code-header">
        <span className="code-lang">{language}</span>
        <button className="copy-btn" onClick={copy}>{copied ? '✓ Copied' : 'Copy'}</button>
      </div>
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        showLineNumbers
        customStyle={{ margin: 0, borderRadius: '0 0 8px 8px', fontSize: '13px' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}