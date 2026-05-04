import axios from 'axios';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

// ── Model Registry ────────────────────────────────────────────
// Maps Ollama model IDs to capability metadata for smart routing
export const MODEL_CAPABILITIES = {
  // General chat
  'mistral':              { strength: ['chat', 'general'],            speed: 'fast',   size: '7B'  },
  'mistral:latest':       { strength: ['chat', 'general'],            speed: 'fast',   size: '7B'  },
  'mistral:7b':           { strength: ['chat', 'general'],            speed: 'fast',   size: '7B'  },
  // Code
  'qwen:latest':          { strength: ['code', 'math'],               speed: 'medium', size: '7B'  },
  'qwen2.5-coder':        { strength: ['code', 'math'],               speed: 'medium', size: '7B'  },
  'qwen2.5-coder:7b':     { strength: ['code', 'math'],               speed: 'medium', size: '7B'  },
  'qwen2.5-coder:14b':    { strength: ['code', 'math'],               speed: 'slow',   size: '14B' },
  'codellama':            { strength: ['code'],                        speed: 'medium', size: '7B'  },
  'codellama:13b':        { strength: ['code'],                        speed: 'slow',   size: '13B' },
  'deepseek-coder':       { strength: ['code', 'math'],               speed: 'medium', size: '6.7B'},
  'deepseek-coder:6.7b':  { strength: ['code', 'math'],               speed: 'medium', size: '6.7B'},
  // Reasoning
  'llama3':               { strength: ['reasoning', 'general'],       speed: 'medium', size: '8B'  },
  'llama3:latest':        { strength: ['reasoning', 'general'],       speed: 'medium', size: '8B'  },
  'llama3:8b':            { strength: ['reasoning', 'general'],       speed: 'medium', size: '8B'  },
  'llama3.1':             { strength: ['reasoning', 'general'],       speed: 'medium', size: '8B'  },
  'llama3.1:8b':          { strength: ['reasoning', 'general'],       speed: 'medium', size: '8B'  },
  'llama3.2':             { strength: ['reasoning', 'general', 'vision'], speed: 'fast', size: '3B'},
  'llama3.3':             { strength: ['reasoning', 'general'],       speed: 'slow',   size: '70B' },
  'phi3':                 { strength: ['reasoning', 'general'],       speed: 'fast',   size: '3.8B'},
  'phi3:mini':            { strength: ['reasoning', 'general'],       speed: 'fast',   size: '3.8B'},
  'phi4':                 { strength: ['reasoning', 'general'],       speed: 'medium', size: '14B' },
  // Vision / multimodal
  'llava':                { strength: ['vision', 'general'],          speed: 'slow',   size: '7B'  },
  'llava:13b':            { strength: ['vision', 'general'],          speed: 'slow',   size: '13B' },
  'moondream':            { strength: ['vision'],                     speed: 'fast',   size: '1.8B'},
  // Math/Science
  'deepseek-r1':          { strength: ['reasoning', 'math', 'code'],  speed: 'slow',   size: '7B'  },
  'deepseek-r1:7b':       { strength: ['reasoning', 'math', 'code'],  speed: 'slow',   size: '7B'  },
  'deepseek-r1:14b':      { strength: ['reasoning', 'math', 'code'],  speed: 'slow',   size: '14B' },
  // Embedding models (for RAG)
  'nomic-embed-text':     { strength: ['embedding'],                  speed: 'fast',   size: '137M'},
  'mxbai-embed-large':    { strength: ['embedding'],                  speed: 'fast',   size: '335M'},
};

// Cache available models to avoid hammering Ollama
let _modelCache = null;
let _modelCacheTime = 0;
const MODEL_CACHE_TTL_MS = 60_000; // 1 minute

// ── Core API calls ────────────────────────────────────────────

export async function chatWithOllama({ model, messages, timeout = 60000 }) {
  if (!model || !messages?.length) throw new Error('model and messages required');

  const response = await axios.post(
    `${OLLAMA_URL}/api/chat`,
    { model, messages, stream: false },
    { timeout }
  );

  return {
    message: {
      role: 'assistant',
      content: response.data.message?.content || '',
    },
    usage: {
      promptTokens:     response.data.prompt_eval_count,
      completionTokens: response.data.eval_count,
      totalDuration:    response.data.total_duration,
    }
  };
}

export async function streamOllamaChat({ model, messages, onDelta, onEnd, onError, signal }) {
  if (!model || !messages?.length) {
    onError(new Error('model and messages required'));
    return;
  }

  let endCalled = false;
  const safeEnd = () => {
    if (!endCalled) { endCalled = true; onEnd(); }
  };

  try {
    const res = await axios.post(
      `${OLLAMA_URL}/api/chat`,
      { model, messages, stream: true },
      { responseType: 'stream', timeout: 180000, signal }
    );

    let buffer = '';

    res.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep last incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.done) {
            safeEnd();
            return;
          }
          if (parsed.message?.content) {
            onDelta(parsed.message.content);
          }
          if (parsed.error) {
            onError(new Error(parsed.error));
            return;
          }
        } catch { /* partial chunk, wait for more */ }
      }
    });

    res.data.on('end', safeEnd);
    res.data.on('error', (err) => onError(err));

  } catch (err) {
    if (err.name === 'CanceledError' || err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
      onError(Object.assign(new Error('Stream aborted'), { name: 'AbortError' }));
    } else {
      const msg = err.response?.data?.error || err.message || 'Ollama connection failed';
      console.error('[Ollama] Stream error:', msg);
      onError(new Error(msg));
    }
  }
}

// ── Model Management ──────────────────────────────────────────

/**
 * List all models currently pulled in Ollama.
 * Results are cached for MODEL_CACHE_TTL_MS to avoid repeat HTTP calls.
 */
export async function listModels(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _modelCache && (now - _modelCacheTime) < MODEL_CACHE_TTL_MS) {
    return _modelCache;
  }

  try {
    const res = await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 5000 });
    const raw = res.data.models || [];

    const enriched = raw.map(m => {
      const key    = m.name;
      const caps   = MODEL_CAPABILITIES[key] || MODEL_CAPABILITIES[key.split(':')[0]] || {};
      return {
        name:     m.name,
        size:     formatBytes(m.size),
        family:   m.details?.family || 'unknown',
        params:   m.details?.parameter_size || caps.size || '?',
        strength: caps.strength || ['general'],
        speed:    caps.speed || 'medium',
        modified: m.modified_at,
      };
    });

    _modelCache     = enriched;
    _modelCacheTime = now;
    return enriched;
  } catch {
    return _modelCache || []; // return stale cache on error
  }
}

/**
 * Pull a model from Ollama registry.
 * Returns an async generator that yields progress events.
 */
export async function* pullModel(modelName) {
  const res = await axios.post(
    `${OLLAMA_URL}/api/pull`,
    { name: modelName, stream: true },
    { responseType: 'stream', timeout: 0 } // no timeout for pulls
  );

  let buffer = '';
  for await (const chunk of res.data) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try { yield JSON.parse(line); } catch { /* skip */ }
    }
  }
}

/**
 * Delete a model from Ollama.
 */
export async function deleteModel(modelName) {
  await axios.delete(`${OLLAMA_URL}/api/delete`, {
    data: { name: modelName },
    timeout: 10000,
  });
  _modelCache = null; // invalidate cache
}

/**
 * Check Ollama health.
 */
export async function checkOllamaHealth() {
  try {
    await axios.get(`${OLLAMA_URL}/api/tags`, { timeout: 3000 });
    return { healthy: true };
  } catch (err) {
    return { healthy: false, error: err.message };
  }
}

/**
 * Get best available model for a given task, from what's actually installed.
 */
export async function getBestModelForTask(task, installedModels) {
  const models = installedModels || await listModels();
  const names  = new Set(models.map(m => m.name));

  const preferences = {
    code:      ['qwen2.5-coder:7b', 'deepseek-coder:6.7b', 'codellama', 'qwen:latest', 'deepseek-r1:7b'],
    reasoning: ['deepseek-r1:7b', 'llama3.1:8b', 'llama3:8b', 'llama3', 'phi4', 'mistral:latest'],
    vision:    ['llava:13b', 'llava', 'llama3.2', 'moondream'],
    embedding: ['mxbai-embed-large', 'nomic-embed-text'],
    chat:      ['mistral:latest', 'mistral', 'llama3:8b', 'phi3:mini'],
    math:      ['deepseek-r1:7b', 'qwen2.5-coder:7b', 'llama3.1:8b'],
  };

  const preferred = preferences[task] || preferences.chat;
  for (const pref of preferred) {
    if (names.has(pref)) return pref;
    // also try without tag
    const base = pref.split(':')[0];
    const found = [...names].find(n => n === base || n.startsWith(base + ':'));
    if (found) return found;
  }

  // Fall back to first available non-embedding model
  const fallback = models.find(m => !m.strength.includes('embedding'));
  return fallback?.name || 'mistral';
}

// ── Helpers ───────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes) return '?';
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;
}