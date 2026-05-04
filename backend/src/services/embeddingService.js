import axios from 'axios';

const OLLAMA_URL  = process.env.OLLAMA_URL  || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL || 'nomic-embed-text';

/**
 * Generate an embedding vector for a single text string.
 * Uses Ollama's /api/embed endpoint with the nomic-embed-text model.
 *
 * @param {string} text
 * @returns {Promise<number[]>} embedding vector
 */
export async function embedText(text) {
  const res = await axios.post(
    `${OLLAMA_URL}/api/embed`,
    { model: EMBED_MODEL, input: text },
    { timeout: 30000 }
  );
  // Ollama returns { embeddings: [[...]] }
  return res.data.embeddings?.[0] ?? res.data.embedding ?? [];
}

/**
 * Generate embedding vectors for an array of text strings in parallel.
 *
 * @param {string[]} texts
 * @returns {Promise<number[][]>} array of embedding vectors
 */
export async function embedBatch(texts) {
  return Promise.all(texts.map(t => embedText(t)));
}
