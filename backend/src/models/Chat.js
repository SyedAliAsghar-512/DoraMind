import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  role:      { type: String, enum: ['user', 'assistant', 'system'], required: true },
  content:   { type: String, required: true, maxlength: 32000 },
  model:     { type: String },
  isCode:    { type: Boolean, default: false }, // did this message contain code?
  tokens:    { type: Number },                  // approx token count for context window mgmt
  timestamp: { type: Date, default: Date.now },
});
 
const ChatSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title:     { type: String, default: 'New Chat', maxlength: 120 },
  model:     { type: String, default: 'mistral' },   // active model for this chat
  pinned:    { type: Boolean, default: false },
  messages:  [MessageSchema],
  // RAG docs attached to this chat
  documentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }],
  // Summary of this chat (generated lazily for memory)
  summary:   { type: String, maxlength: 1000 },
  summaryAt: { type: Date },
}, { timestamps: true });
 
// Auto-title from first user message
ChatSchema.methods.autoTitle = function () {
  const firstUser = this.messages.find(m => m.role === 'user');
  if (firstUser && this.title === 'New Chat') {
    this.title = firstUser.content.substring(0, 80).replace(/\n/g, ' ');
  }
};
 
// Truncate messages to last N for context window
ChatSchema.methods.getContextMessages = function (maxTokens = 6000) {
  const msgs = [...this.messages];
  let total = 0;
  const result = [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = msgs[i].tokens || Math.ceil(msgs[i].content.length / 4);
    if (total + t > maxTokens) break;
    result.unshift(msgs[i]);
    total += t;
  }
  return result;
};
 
export const Chat = mongoose.model('Chat', ChatSchema);