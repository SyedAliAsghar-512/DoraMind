import { Chat }       from '../models/Chat.js';
import { Memory }      from '../models/Memory.js';
import { embedText }   from '../services/embeddingService.js';
import { searchSimilarChunks } from '../services/vectorDBService.js';
import { selectModel }         from '../services/modelRouter.js';
import { streamOllamaChat }    from '../services/ollamaService.js';
import { extractAndUpdateMemory } from '../services/memoryService.js';

const MAX_RAG_CHUNKS = 8;
const MAX_RAG_CHARS  = 12_000;

/**
 * POST /api/chat/:chatId/rag-stream
 * RAG-based streaming chat via Server-Sent Events (SSE).
 *
 * Flow:
 *  1. Embed the user query via Ollama (nomic-embed-text)
 *  2. Semantic search in ChromaDB for top-k relevant chunks
 *  3. Build context prompt
 *  4. Stream response from Ollama (llama3.1:8b or best available)
 */
export async function ragStream(req, res) {
  const { chatId } = req.params;
  const { content, model: preferredModel } = req.body;
  const userId = req.userId;

  if (!content?.trim()) {
    return res.status(400).json({ error: 'content is required.' });
  }

  // ── Load chat ────────────────────────────────────────────────
  const chat = await Chat.findOne({ _id: chatId, userId });
  if (!chat) return res.status(404).json({ error: 'Chat not found.' });

  // ── Load memory ──────────────────────────────────────────────
  let memory = null;
  try { memory = await Memory.findOrCreate(userId); } catch {}

  // ── Vector search for relevant chunks ───────────────────────
  let ragChunks = [];
  try {
    const queryVec = await embedText(content);
    const { texts, metadatas } = await searchSimilarChunks(
      userId.toString(),
      queryVec,
      MAX_RAG_CHUNKS
    );

    let totalChars = 0;
    for (let i = 0; i < texts.length; i++) {
      if (totalChars >= MAX_RAG_CHARS) break;
      ragChunks.push({
        filename: metadatas[i]?.filename || 'document',
        text:     texts[i],
      });
      totalChars += texts[i].length;
    }
  } catch (err) {
    console.error('[RAG] Vector search failed:', err.message);
    // Continue without RAG context
  }

  // ── Stage user message ───────────────────────────────────────
  const cleanContent = sanitizeInput(content);
  chat.messages.push({
    role:      'user',
    content:   cleanContent,
    tokens:    Math.ceil(cleanContent.length / 4),
    timestamp: new Date(),
  });
  if (chat.messages.filter(m => m.role === 'user').length === 1) {
    chat.title = cleanContent.substring(0, 80).replace(/\n/g, ' ');
  }

  // ── Model routing ────────────────────────────────────────────
  let routeResult;
  try {
    routeResult = await selectModel({
      query:        cleanContent,
      hasDocuments: ragChunks.length > 0,
      preferred:    preferredModel,
      memory,
    });
  } catch {
    routeResult = { model: preferredModel || 'llama3.1:8b', mode: 'rag', task: 'rag' };
  }
  const { model, mode } = routeResult;
  chat.model = model;

  // ── Build Ollama messages ────────────────────────────────────
  const systemPrompt = buildSystemPrompt(mode, ragChunks);
  const contextMessages = chat.getContextMessages(4000);
  const ollamaMessages = [
    { role: 'system', content: systemPrompt },
    ...contextMessages.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: cleanContent },
  ];

  // ── Persist user message ─────────────────────────────────────
  try { await chat.save(); } catch {}

  // ── SSE headers ──────────────────────────────────────────────
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send  = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const done  = () => { try { res.write('data: [DONE]\n\n'); res.end(); } catch {} };

  send({ type: 'stream_start', model, mode, chatId });

  let fullResponse = '';
  let streamDone   = false;
  const abort      = new AbortController();
  req.on('close', () => abort.abort());

  await streamOllamaChat({
    model,
    messages: ollamaMessages,
    signal:   abort.signal,

    onDelta: (delta) => {
      fullResponse += delta;
      send({ type: 'delta', delta });
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
          await freshChat.save();
        }
      } catch {}

      send({ type: 'stream_end', model, chatId });
      done();

      extractAndUpdateMemory(userId, cleanContent, fullResponse, chatId)
        .catch(() => {});
    },

    onError: (err) => {
      if (streamDone) return;
      streamDone = true;
      if (err.name !== 'AbortError') {
        send({ type: 'error', message: err.message });
      }
      done();
    },
  });
}

// ── Helpers ───────────────────────────────────────────────────

function buildSystemPrompt(mode, ragChunks) {
  let prompt = `You are DoraMind, an expert AI assistant with strong reasoning capabilities.`;

  if (ragChunks.length > 0) {
    prompt += `\n\nAnswer using the provided document context below. Quote relevant sections when helpful. If the answer is not in the documents, say so clearly.\n\n## DOCUMENT CONTEXT\n${'-'.repeat(60)}`;

    const byFile = {};
    for (const c of ragChunks) {
      if (!byFile[c.filename]) byFile[c.filename] = [];
      byFile[c.filename].push(c.text);
    }
    for (const [filename, texts] of Object.entries(byFile)) {
      prompt += `\n\n### File: "${filename}"\n`;
      texts.forEach((t, i) => { prompt += `[Excerpt ${i + 1}]:\n${t}\n`; });
    }
    prompt += `\n${'-'.repeat(60)}\n⚠️  Base your answer strictly on the excerpts above.`;
  } else {
    prompt += `\nRespond naturally and helpfully. Be accurate and concise.`;
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
