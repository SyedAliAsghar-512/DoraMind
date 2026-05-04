import crypto from 'crypto';
import { Document }        from '../models/Document.js';
import { documentQueue }   from '../queue/index.js';
import { deleteDocumentChunks } from '../services/vectorDBService.js';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

// ── GET /api/docs ──────────────────────────────────────────────

export async function getDocuments(req, res) {
  const docs = await Document.find({ userId: req.userId })
    .select('-fileChunks')
    .sort({ uploadedAt: -1 });

  res.json({ documents: docs });
}

// ── POST /api/docs/upload ──────────────────────────────────────

export async function uploadDocument(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const { originalname, mimetype, size, buffer } = req.file;

  if (size > MAX_FILE_SIZE) {
    return res.status(413).json({ error: 'File too large (20 MB max).' });
  }

  // ── MD5 hash for deduplication (Phase 2D) ──────────────────
  const fileHash = crypto.createHash('md5').update(buffer).digest('hex');

  // If same file already processed for this user, skip reprocessing
  const existing = await Document.findOne({ userId: req.userId, fileHash, processed: true })
    .select('-fileChunks');
  if (existing) {
    return res.status(201).json({ document: existing, reused: true });
  }

  // ── Save metadata immediately — respond <200 ms ────────────
  const doc = await Document.create({
    userId:   req.userId,
    filename: originalname,
    mimeType: mimetype,
    sizeBytes: size,
    fileHash,
    processed: false,
  });

  res.status(201).json({ document: doc });

  // ── Enqueue background processing job ──────────────────────
  await documentQueue.add('process-document', {
    docId:        doc._id.toString(),
    bufferBase64: buffer.toString('base64'),
    filename:     originalname,
    mimeType:     mimetype,
    userId:       req.userId.toString(),
  });
}

// ── DELETE /api/docs/:docId ────────────────────────────────────

export async function deleteDocument(req, res) {
  const doc = await Document.findOneAndDelete({
    _id:    req.params.docId,
    userId: req.userId,
  });

  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  // Remove chunks from vector DB
  await deleteDocumentChunks(req.params.docId, req.userId.toString()).catch(() => {});

  res.json({ ok: true });
}

// ── GET /api/docs/:docId/chunks ───────────────────────────────

export async function getDocumentChunks(req, res) {
  const doc = await Document.findOne({
    _id:    req.params.docId,
    userId: req.userId,
  });

  if (!doc) return res.status(404).json({ error: 'Not found.' });

  res.json(doc);
}
