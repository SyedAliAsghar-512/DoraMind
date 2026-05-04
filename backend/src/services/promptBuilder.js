export function buildPrompt({ systemPrompt, contextMessages, ragChunks = [] }) {
  const messages = [];
 
  // System message
  let sysContent = systemPrompt;
  if (ragChunks.length) {
    sysContent += '\n\n=== Document Context ===\n';
    ragChunks.forEach((chunk, i) => {
      sysContent += `[Section ${i + 1}]: ${chunk.text}\n`;
    });
    sysContent += '\nUse the document context above to answer accurately.';
  }
  messages.push({ role: 'system', content: sysContent });
 
  // Conversation history
  for (const msg of contextMessages) {
    messages.push({ role: msg.role, content: msg.content });
  }
 
  return messages;
}