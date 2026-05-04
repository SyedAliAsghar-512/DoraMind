import { Worker }   from 'bullmq';
import mongoose      from 'mongoose';
import { redisConnection } from '../queue/index.js';
import { Document }        from '../models/Document.js';
import { extractPdfText }  from '../services/pdfService.js';
import { extractDocxText, extractPptxText } from '../services/docService.js';
import { embedBatch }      from '../services/embeddingService.js';
import { addDocumentChunks } from '../services/vectorDBService.js';

// ── Text chunking (300–500 tokens) ────────────────────────────

const CHUNK_SIZE    = 400;  // target words per chunk
const CHUNK_OVERLAP = 50;   // words carried over to next chunk

function chunkText(text) {
  const words  = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];

  for (let i = 0; i < words.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
    const slice = words.slice(i, i + CHUNK_SIZE).join(' ').trim();
    if (slice.split(/\s+/).length > 5) chunks.push(slice); // skip tiny fragments
  }

  return chunks;
}

// ── Core job handler ──────────────────────────────────────────

async function processDocument(job) {
  const { docId, bufferBase64, filename, mimeType, userId } = job.data;

  const buffer = Buffer.from(bufferBase64, 'base64');
  const ext    = filename.split('.').pop()?.toLowerCase() || '';

  const isPdf  = mimeType === 'application/pdf' || ext === 'pdf';
  const isWord = ['doc', 'docx'].includes(ext);
  const isPpt  = ['ppt', 'pptx'].includes(ext);
  const isText = !isPdf && !isWord && !isPpt;

  let text = '';

  if (isPdf) {
    text = await extractPdfText(buffer);
  } else if (isWord) {
    text = await extractDocxText(buffer);
  } else if (isPpt) {
    text = await extractPptxText(buffer);
  } else if (isText) {
    text = buffer.toString('utf-8');
  }

  if (!text.trim()) {
    await Document.findByIdAndUpdate(docId, {
      processed:       true,
      extractionError: 'No text could be extracted from this file',
    });
    return;
  }

  const chunks = chunkText(text);

  // Generate embeddings in parallel
  const embeddings = await embedBatch(chunks);

  // Store in ChromaDB
  await addDocumentChunks(docId, userId, chunks, embeddings, { filename });

  // Persist chunks + mark processed in MongoDB
  await Document.findByIdAndUpdate(docId, {
    fileChunks:  chunks,
    chunkCount:  chunks.length,
    processed:   true,
    extractionError: undefined,
  });

  console.log(`[Worker] ✅ ${filename}: ${chunks.length} chunks embedded`);
}

// ── Worker factory ────────────────────────────────────────────

let _worker = null;

export function startDocumentWorker() {
  if (_worker) return _worker; // singleton

  _worker = new Worker('document-processing', processDocument, {
    connection: redisConnection,
    concurrency: 2,
  });

  _worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} (${job.data?.filename}) completed`);
  });

  _worker.on('failed', async (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed: ${err.message}`);
    if (job?.data?.docId) {
      await Document.findByIdAndUpdate(job.data.docId, {
        extractionError: err.message,
      }).catch(() => {});
    }
  });

  _worker.on('error', (err) => {
    console.error('[Worker] Worker error:', err.message);
  });

  console.log('[Worker] Document processing worker started');
  return _worker;
}

export async function stopDocumentWorker() {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
}
