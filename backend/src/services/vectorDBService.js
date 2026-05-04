import { ChromaClient } from 'chromadb';

const chroma = new ChromaClient({
  path: process.env.CHROMA_URL || 'http://localhost:8000',
});

/**
 * Sanitize a user ID into a valid ChromaDB collection name.
 * Collection names must be 3-63 chars, alphanumeric + hyphens, start/end with alphanumeric.
 */
function collectionName(userId) {
  return `user-${userId.toString().replace(/[^a-z0-9]/gi, '-').toLowerCase()}`;
}

/**
 * Store document chunks + their pre-computed embeddings in ChromaDB.
 *
 * @param {string}   docId      - MongoDB document _id string
 * @param {string}   userId     - MongoDB user _id string
 * @param {string[]} chunks     - text chunks
 * @param {number[][]} embeddings - one embedding per chunk
 * @param {{ filename: string }} metadata
 */
export async function addDocumentChunks(docId, userId, chunks, embeddings, metadata) {
  if (!chunks.length) return;

  const col = await chroma.getOrCreateCollection({ name: collectionName(userId) });

  await col.add({
    ids:        chunks.map((_, i) => `${docId}_chunk_${i}`),
    embeddings,
    documents:  chunks,
    metadatas:  chunks.map((_, i) => ({
      docId:      docId.toString(),
      filename:   metadata.filename,
      chunkIndex: i,
    })),
  });
}

/**
 * Semantic search: find the top-k most similar chunks across all documents of a user.
 *
 * @param {string}   userId
 * @param {number[]} queryEmbedding
 * @param {number}   topK
 * @returns {Promise<{ texts: string[], metadatas: object[] }>}
 */
export async function searchSimilarChunks(userId, queryEmbedding, topK = 8) {
  let col;
  try {
    col = await chroma.getCollection({ name: collectionName(userId) });
  } catch {
    return { texts: [], metadatas: [] };
  }

  const results = await col.query({
    queryEmbeddings: [queryEmbedding],
    nResults:        topK,
  });

  const texts     = results.documents?.[0]  || [];
  const metadatas = results.metadatas?.[0]  || [];
  return { texts, metadatas };
}

/**
 * Delete all chunks belonging to a specific document from ChromaDB.
 *
 * @param {string} docId
 * @param {string} userId
 */
export async function deleteDocumentChunks(docId, userId) {
  try {
    const col = await chroma.getCollection({ name: collectionName(userId) });
    await col.delete({ where: { docId: docId.toString() } });
  } catch {
    // collection may not exist yet — silently ignore
  }
}

/**
 * Quick health check: returns true if ChromaDB is reachable.
 */
export async function checkChromaHealth() {
  try {
    await chroma.heartbeat();
    return true;
  } catch {
    return false;
  }
}
