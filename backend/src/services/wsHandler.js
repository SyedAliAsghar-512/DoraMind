import jwt from 'jsonwebtoken';
import { Chat }    from '../models/Chat.js';
import { Memory }  from '../models/Memory.js';
import { Document } from '../models/Document.js';
import { selectModel }            from './modelRouter.js';
import { buildPrompt }            from './promptBuilder.js';
import { streamOllamaChat }       from './ollamaService.js';
import { extractAndUpdateMemory } from './memoryService.js';

const PING_INTERVAL_MS = 25_000;
const MAX_MSG_LENGTH   = 16_000;
const MAX_RAG_CHUNKS   = 8;       // inject up to 8 chunks per document
const MAX_RAG_CHARS    = 12_000;  // hard cap on total injected text

export function handleWebSocket(ws, req, wss) {
  let userId        = null;
  let authenticated = false;
  let pingTimer     = null;
  let activeAbort   = null;

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  pingTimer = setInterval(() => {
    if (!ws.isAlive) { clearInterval(pingTimer); ws.terminate(); return; }
    ws.isAlive = false;
    if (ws.readyState === ws.OPEN) ws.ping();
  }, PING_INTERVAL_MS);

  ws.on('close',  ()    => { clearInterval(pingTimer); activeAbort?.abort(); });
  ws.on('error',  (err) => { console.error('[WS] error:', err.message); clearInterval(pingTimer); activeAbort?.abort(); });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); }
    catch { return safeSend(ws, { type: 'error', message: 'Invalid JSON.' }); }

    switch (msg.type) {
      case 'auth':
        return handleAuth(ws, msg, (id) => { userId = id; authenticated = true; });
      case 'chat':
        if (!authenticated) return safeSend(ws, { type: 'error', message: 'Not authenticated.' });
        return handleChatMessage(ws, userId, msg, (ctrl) => { activeAbort = ctrl; });
      case 'abort':
        if (!authenticated) return;
        activeAbort?.abort();
        activeAbort = null;
        safeSend(ws, { type: 'aborted' });
        return;
      default:
        safeSend(ws, { type: 'error', message: `Unknown type: ${msg.type}` });
    }
  });
}

// ── Auth ──────────────────────────────────────────────────────
function handleAuth(ws, msg, onSuccess) {
  try {
    const decoded = jwt.verify(msg.token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    onSuccess(decoded.sub);
    safeSend(ws, { type: 'auth_ok', userId: decoded.sub });
  } catch {
    safeSend(ws, { type: 'error', message: 'Authentication failed.' });
    ws.close(4001, 'Unauthorized');
  }
}

// ── Main chat handler ─────────────────────────────────────────
async function handleChatMessage(ws, userId, msg, setAbortController) {
  const { chatId, content, model: preferredModel } = msg;

  if (!chatId || !content?.trim()) {
    return safeSend(ws, { type: 'error', message: 'chatId and content are required.' });
  }
  if (content.length > MAX_MSG_LENGTH) {
    return safeSend(ws, { type: 'error', message: `Message too long (max ${MAX_MSG_LENGTH} chars).` });
  }

  // ── 1. Load chat ──────────────────────────────────────────
  let chat;
  try {
    chat = await Chat.findOne({ _id: chatId, userId });
    if (!chat) return safeSend(ws, { type: 'error', message: 'Chat not found.' });
  } catch {
    return safeSend(ws, { type: 'error', message: 'DB error loading chat.' });
  }

  // ── 2. Load memory ────────────────────────────────────────
  let memory = null;
  try { memory = await Memory.findOrCreate(userId); } catch {}

  // ── 3. Load & prepare document context (THE CRITICAL FIX) ─
  let ragChunks  = [];   // { filename, text }[]
  let imageData  = [];   // { base64, mediaType, filename }[]
  let hasImages  = false;

  if (chat.documentIds?.length > 0) {
    try {
      // Fetch FULL documents including chunks and imageBase64
      const docs = await Document.find({
        _id: { $in: chat.documentIds },
        userId,
      }).select('filename mimeType fileChunks imageBase64 imageMediaType isImage processed');

      for (const doc of docs) {
        if (doc.isImage && doc.imageBase64) {
          // Vision: collect image data to pass directly to Ollama
          imageData.push({
            base64:    doc.imageBase64,
            mediaType: doc.imageMediaType || 'image/jpeg',
            filename:  doc.filename,
          });
          hasImages = true;

        } else if (doc.fileChunks?.length > 0) {
          // RAG: score chunks by relevance to the user's query
          const scored = scoreChunks(doc.fileChunks, content);
          const topChunks = scored
            .slice(0, MAX_RAG_CHUNKS)
            .map(c => ({ filename: doc.filename, text: c.text }));
          ragChunks.push(...topChunks);
        }
      }

      // Hard cap on total RAG text injected
      let totalChars = 0;
      ragChunks = ragChunks.filter(c => {
        if (totalChars >= MAX_RAG_CHARS) return false;
        totalChars += c.text.length;
        return true;
      });

    } catch (err) {
      console.error('[WS] Failed to load documents:', err.message);
    }
  }

  // ── 4. Sanitize & stage user message ─────────────────────
  const cleanContent = sanitizeInput(content);
  const userMsg = {
    role:      'user',
    content:   cleanContent,
    tokens:    Math.ceil(cleanContent.length / 4),
    timestamp: new Date(),
  };
  chat.messages.push(userMsg);

  if (chat.messages.filter(m => m.role === 'user').length === 1) {
    chat.title = cleanContent.substring(0, 80).replace(/\n/g, ' ');
  }

  // ── 5. Model routing ──────────────────────────────────────
  let routeResult;
  try {
    routeResult = await selectModel({
      query:        cleanContent,
      hasDocuments: ragChunks.length > 0,
      hasImages,
      preferred:    preferredModel,
      memory,
    });
  } catch {
    routeResult = { model: preferredModel || 'mistral', mode: 'chat', task: 'chat' };
  }
  const { model, mode } = routeResult;
  chat.model = model;

  // ── 6. Build Ollama messages with full context ────────────
  let systemPrompt;
  try   { systemPrompt = buildSystemPrompt(memory, mode, ragChunks, imageData); }
  catch { systemPrompt = 'You are DoraMind, a helpful AI assistant.'; }

  const contextMessages = chat.getContextMessages(5000);
  // buildPrompt returns the messages array ready for Ollama
  const ollamaMessages = buildPrompt({
    systemPrompt,
    contextMessages: contextMessages.map(m => ({ role: m.role, content: m.content })),
    ragChunks,
    imageData,
    userQuery: cleanContent,
  });

  // ── 7. Persist user message ───────────────────────────────
  try { await chat.save(); } catch (err) {
    console.error('[WS] user msg save failed:', err.message);
  }

  // ── 8. Stream ─────────────────────────────────────────────
  safeSend(ws, { type: 'stream_start', model, mode, chatId });

  let fullResponse = '';
  let streamDone   = false;
  const abort      = new AbortController();
  setAbortController(abort);

  await streamOllamaChat({
    model,
    messages: ollamaMessages,
    signal:   abort.signal,

    onDelta: (delta) => {
      fullResponse += delta;
      safeSend(ws, { type: 'stream_delta', delta });
    },

    onEnd: async () => {
      if (streamDone) return;
      streamDone = true;

      const assistantMsg = {
        role:      'assistant',
        content:   fullResponse,
        model,
        tokens:    Math.ceil(fullResponse.length / 4),
        isCode:    /```/.test(fullResponse),
        timestamp: new Date(),
      };

      try {
        const freshChat = await Chat.findById(chatId);
        if (freshChat) {
          freshChat.messages.push(assistantMsg);
          if (freshChat.title === 'New Chat') {
            freshChat.title = cleanContent.substring(0, 80).replace(/\n/g, ' ');
          }
          await freshChat.save();
          safeSend(ws, { type: 'stream_end', model, chatId, messageId: assistantMsg._id?.toString() });

          // Background memory extraction
          extractAndUpdateMemory(userId, cleanContent, fullResponse, chatId)
            .catch(e => console.error('[WS] Memory error:', e.message));
        } else {
          safeSend(ws, { type: 'stream_end', model, chatId });
        }
      } catch (err) {
        console.error('[WS] assistant msg save failed:', err.message);
        safeSend(ws, { type: 'stream_end', model, chatId, saveError: true });
      }
    },

    onError: (err) => {
      if (streamDone) return;
      streamDone = true;
      if (err.name === 'AbortError') return;

      console.error('[WS] stream error:', err.message);
      safeSend(ws, {
        type:    'error',
        message: err.message.includes('ECONNREFUSED')
          ? 'Ollama is not running. Please start Ollama and try again.'
          : `AI error: ${err.message}`,
      });

      if (fullResponse.length > 10) {
        Chat.findById(chatId).then(c => {
          if (!c) return;
          c.messages.push({ role: 'assistant', content: fullResponse + '\n\n*(interrupted)*', model, timestamp: new Date() });
          return c.save();
        }).catch(() => {});
      }
    },
  });
}

// ── Relevant chunk scoring (simple keyword overlap) ───────────
function scoreChunks(chunks, query) {
  const queryWords = new Set(
    query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3)
  );

  return chunks
    .map(text => {
      const chunkWords = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/);
      const overlap    = chunkWords.filter(w => queryWords.has(w)).length;
      const score      = overlap / Math.max(queryWords.size, 1);
      return { text, score };
    })
    .sort((a, b) => b.score - a.score);
}

// ── System prompt builder ─────────────────────────────────────
function buildSystemPrompt(memory, mode, ragChunks = [], imageData = []) {
  const modeInstructions = {
    chat:      'Respond naturally and helpfully. Be accurate, concise, and friendly.',
    code: `Write clean, production-ready code.
Rules:
- Always use markdown code blocks with the correct language tag
- Include brief comments explaining non-obvious parts  
- Show example usage when helpful
- Point out potential edge cases or gotchas
- If asked to debug, explain what was wrong and why the fix works`,
    math: `Solve step-by-step.
Rules:
- Show ALL intermediate steps
- Use clear mathematical notation
- Double-check your answer
- State any assumptions made`,
    reasoning: `Think carefully and systematically.
Rules:
- Break complex problems into smaller parts
- Consider multiple perspectives
- State your reasoning explicitly
- If uncertain, say so and explain why`,
    rag: `Answer using ONLY the provided document context below.
Rules:
- Quote or reference specific sections when relevant
- If the answer is NOT in the documents, say "I don't see that in the provided documents"
- Do not hallucinate information not present in the documents
- Cite which document/section your answer comes from`,
    vision: `Analyze the image(s) carefully.
Rules:
- Be specific about what you see (colors, text, layout, objects)
- Read any visible text accurately  
- Describe spatial relationships
- Note anything unusual or important`,
  };

  const instructions = modeInstructions[mode] || modeInstructions.chat;

  let prompt = `You are DoraMind, an expert AI assistant with strong reasoning capabilities.
You are precise, accurate, and adapt your communication style to the user.

## YOUR TASK
${instructions}`;

  // Inject memory/personality context
  if (memory) {
    try {
      const memCtx = memory.toPromptContext?.();
      if (memCtx?.trim()) {
        prompt += `\n\n## USER PROFILE (use to personalize your responses)\n${memCtx}`;
      }
      const level = memory.personality?.expertiseLevel;
      const style = memory.personality?.communicationStyle;
      if (level === 'beginner')  prompt += '\n\nNote: User is a beginner — explain concepts clearly, avoid jargon.';
      if (level === 'expert')    prompt += '\n\nNote: User is an expert — use technical depth, skip basics.';
      if (style === 'casual')    prompt += '\n\nNote: Use a casual, friendly tone.';
      if (style === 'formal')    prompt += '\n\nNote: Use a formal, professional tone.';
      if (style === 'technical') prompt += '\n\nNote: Use technical terminology freely.';
    } catch {}
  }

  // Inject document chunks for RAG
  if (ragChunks.length > 0) {
    prompt += '\n\n## DOCUMENT CONTEXT';
    prompt += '\nThe following content was extracted from the user\'s uploaded file(s):';
    prompt += '\n' + '─'.repeat(60);

    // Group by filename
    const byFile = {};
    for (const c of ragChunks) {
      if (!byFile[c.filename]) byFile[c.filename] = [];
      byFile[c.filename].push(c.text);
    }

    for (const [filename, texts] of Object.entries(byFile)) {
      prompt += `\n\n### File: "${filename}"\n`;
      texts.forEach((t, i) => {
        prompt += `[Excerpt ${i + 1}]:\n${t}\n`;
      });
    }
    prompt += '\n' + '─'.repeat(60);
    prompt += '\n⚠️  Answer the user\'s question using the document content above. Quote directly when relevant.';
  }

  // Note about images (actual image bytes are passed in the message, not here)
  if (imageData.length > 0) {
    const names = imageData.map(i => `"${i.filename}"`).join(', ');
    prompt += `\n\n## ATTACHED IMAGES\nThe user has attached ${imageData.length} image(s): ${names}. Analyze them carefully in your response.`;
  }

  return prompt;
}

function sanitizeInput(text) {
  return text
    .replace(/<\|.*?\|>/g, '')
    .replace(/\[INST\]|\[\/INST\]/g, '')
    .replace(/<<<sys>>>|<<<end>>>/g, '')
    .replace(/\x00/g, '')
    .trim();
}

function safeSend(ws, data) {
  if (ws.readyState === ws.OPEN) {
    try { ws.send(JSON.stringify(data)); }
    catch (err) { console.error('[WS] send error:', err.message); }
  }
}