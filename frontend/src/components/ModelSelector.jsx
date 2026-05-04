import React from 'react'

const MODEL_OPTIONS = [
  { value: "mistral",        feature: "General chat · Fast"             },
  { value: "llama3",         feature: "Deep reasoning · Smart"           },
  { value: "qwen:latest",    feature: "Coding · Math · Analysis"         },
  { value: "mistral:latest", feature: "Best quality · Latest model"      },
]

export default function ModelSelector({ model, setModel, disabled }) {
  return (
    <select
      className="model-selector"
      value={model}
      onChange={e => setModel(e.target.value)}
      disabled={disabled}
      aria-label="Choose assistant behavior"
    >
      {MODEL_OPTIONS.map(opt => (
        <option key={opt.value} value={opt.value}>{opt.feature}</option>
      ))}
    </select>
  )
}