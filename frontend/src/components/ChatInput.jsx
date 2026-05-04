import React, { useState, useRef, useEffect } from 'react'
import ModelSelector from './ModelSelector'
import api from '../services/api'

const ACCEPTED_TYPES = [
  '.txt', '.md', '.pdf', '.csv', '.json',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.go', '.rs', '.cpp', '.c', '.java', '.rb', '.php', '.sh',
  '.html', '.css', '.yaml', '.yml', '.xml', '.sql',
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp',
  '.doc', '.docx',
].join(',')

function fileIcon(mimeType, filename) {
  const ext = filename?.split('.').pop()?.toLowerCase()
  if (mimeType?.startsWith('image/')) return '🖼️'
  if (ext === 'pdf') return '📕'
  if (['js','ts','jsx','tsx','py','go','rs','cpp','c','java','rb','php'].includes(ext)) return '💻'
  if (['json','yaml','yml','xml'].includes(ext)) return '🔧'
  if (ext === 'csv') return '📊'
  if (['doc','docx'].includes(ext)) return '📝'
  return '📄'
}

export default function ChatInput({
  onSend,
  onAbort,
  streaming,
  disabled,
  model,
  setModel,
}) {
  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState([])
  const [uploading, setUploading] = useState(false)

  const textareaRef = useRef(null)
  const fileInputRef = useRef(null)

  // ✅ Better auto-resize (no flicker)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return

    el.style.height = '0px'
    const newHeight = Math.min(el.scrollHeight, 180)
    el.style.height = newHeight + 'px'
  }, [value])

  const submit = () => {
    if ((!value.trim() && attachments.length === 0) || disabled || uploading) return

    onSend(value.trim(), attachments)

    setValue('')
    setAttachments([])

    // ✅ Keep minimum height instead of shrinking to 0
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = '44px'
      }
    })
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

const handleFileChange = async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  setUploading(true);

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await api.post('/docs/upload', formData);

    const docs = res.data.documents;

    setAttachments(prev => [
      ...prev,
      ...docs.map(doc => ({
        ...doc,
        _previewUrl: file.type.startsWith('image/')
          ? URL.createObjectURL(file)
          : null
      }))
    ]);

  } catch (err) {
    alert('Upload failed');
  } finally {
    setUploading(false);
  }
};

  const removeAttachment = (index) => {
    const att = attachments[index]
    if (att?._previewUrl) URL.revokeObjectURL(att._previewUrl)
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const isActive =
    !disabled && !uploading && !streaming &&
    (value.trim() || attachments.length > 0)

  return (
    <div className="chat-input-outer">
      <div className="chat-input-area">

        <div className="input-wrapper">

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="attachments-bar">
              {attachments.map((doc, idx) => (
                <div key={idx} className="attachment-pill">
                  {doc._previewUrl ? (
                    <img src={doc._previewUrl} className="attachment-image-thumb" alt="" />
                  ) : (
                    <span>{fileIcon(doc.mimeType, doc.filename)}</span>
                  )}
                  <span className="attachment-name">{doc.filename}</span>
                  <button onClick={() => removeAttachment(idx)}>✕</button>
                </div>
              ))}
            </div>
          )}

          {/* Input row */}
          <div className="input-row">

            <input
              type="file"
              ref={fileInputRef}
              hidden
              onChange={handleFileChange}
              accept={ACCEPTED_TYPES}
            />

            <button
              className="attach-btn"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled || streaming || uploading}
            >
              📎
            </button>

            <textarea
              ref={textareaRef}
              className="chat-textarea"
              placeholder={
                uploading ? 'Uploading...' :
                streaming ? 'Generating...' :
                'Message DoraMind...'
              }
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKey}
              rows={2}   // ✅ important fix
            />
                      {/* Model selector */}
          <div className="input-toolbar-top">
            <ModelSelector model={model} setModel={setModel} disabled={streaming || disabled} />
          </div>

            <div className="input-actions">
              {streaming ? (
                <button className="stop-btn" onClick={onAbort}>■</button>
              ) : (
                <button
                  className={`send-btn ${isActive ? 'active' : ''}`}
                  onClick={submit}
                  disabled={!isActive}
                >
                  ↑
                </button>
              )}
            </div>
          </div>

        </div>

        <p className="input-hint">
          DoraMind can make mistakes. Verify important information.
        </p>
      </div>
    </div>
  )
}