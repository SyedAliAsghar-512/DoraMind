import { Document } from '../models/Document.js';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from 'canvas';

// ✅ REQUIRED for PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc =
  new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_PDF_PAGES = 3; // ⚡ reduced for speed
const PDF_IMAGE_SCALE = 1.2;

// ─────────────────────────────────────────────
// MAIN CONTROLLERS
// ─────────────────────────────────────────────

export async function getDocuments(req, res) {
  const docs = await Document.find({ userId: req.userId })
    .select('-fileChunks -imageBase64')
    .sort({ uploadedAt: -1 });

  res.json({ documents: docs });
}

export async function uploadDocument(req, res) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  const { originalname, mimetype, size, buffer } = req.file;

  if (size > MAX_FILE_SIZE) {
    return res.status(413).json({ error: 'File too large (20MB max)' });
  }

  const ext = originalname.split('.').pop()?.toLowerCase();

  const isPdf = mimetype === 'application/pdf' || ext === 'pdf';
  const isWord = ext === 'docx' || ext === 'doc';
  const isPpt = ext === 'pptx' || ext === 'ppt';
  const isImage = mimetype.startsWith('image/');

  // ✅ Save immediately (FAST RESPONSE)
  const doc = await Document.create({
    userId: req.userId,
    filename: originalname,
    mimeType: mimetype,
    sizeBytes: size,
    processed: false
  });

  res.status(201).json({ document: doc });

  // ⚡ Background processing
  process.nextTick(() => {
    processFile(doc._id, buffer, originalname, {
      isPdf, isWord, isPpt, isImage
    });
  });
}

export async function deleteDocument(req, res) {
  await Document.deleteOne({ _id: req.params.docId, userId: req.userId });
  res.json({ ok: true });
}

export async function getDocumentChunks(req, res) {
  const doc = await Document.findOne({
    _id: req.params.docId,
    userId: req.userId
  });

  if (!doc) return res.status(404).json({ error: 'Not found' });

  res.json(doc);
}

// ─────────────────────────────────────────────
// BACKGROUND PROCESSOR (🔥 KEY PART)
// ─────────────────────────────────────────────

async function processFile(docId, buffer, filename, types) {
  try {
    let text = '';
    let chunks = [];
    let images = [];

    if (types.isPdf) {
      text = await extractPdfText(buffer);
      chunks = chunkText(text);
      images = await renderPdfToImages(buffer, filename);
    }

    if (types.isWord) {
      text = await extractDocxText(buffer);
      chunks = chunkText(text);
    }

    if (types.isPpt) {
      text = await extractPptxText(buffer);
      chunks = chunkText(text);
    }

    if (types.isImage) {
      chunks = [`[Image: ${filename}]`];
    }

    await Document.findByIdAndUpdate(docId, {
      fileChunks: chunks,
      processed: true
    });

  } catch (err) {
    await Document.findByIdAndUpdate(docId, {
      extractionError: err.message
    });
  }
}

// ─────────────────────────────────────────────
// FAST PDF TEXT (single engine)
// ─────────────────────────────────────────────

async function extractPdfText(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, i) => {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      return content.items.map(i => i.str).join(' ');
    })
  );

  return pages.join('\n');
}

// ─────────────────────────────────────────────
// PARALLEL IMAGE RENDERING
// ─────────────────────────────────────────────

async function renderPdfToImages(buffer, filename) {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const total = Math.min(pdf.numPages, MAX_PDF_PAGES);

  const tasks = Array.from({ length: total }, async (_, i) => {
    const page = await pdf.getPage(i + 1);

    const viewport = page.getViewport({ scale: PDF_IMAGE_SCALE });
    const canvas = createCanvas(viewport.width, viewport.height);

    await page.render({
      canvasContext: canvas.getContext('2d'),
      viewport
    }).promise;

    return {
      base64: canvas.toBuffer('image/png').toString('base64'),
      mediaType: 'image/png',
      filename: `${filename}_page_${i + 1}.png`
    };
  });

  return Promise.all(tasks);
}

// ─────────────────────────────────────────────

async function extractDocxText(buffer) {
  const res = await mammoth.extractRawText({ buffer });
  return res.value;
}

async function extractPptxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files).filter(f => f.includes('slide'));

  let text = '';

  for (const s of slides) {
    const xml = await zip.files[s].async('text');
    text += xml.replace(/<[^>]+>/g, ' ') + ' ';
  }

  return text;
}

// ─────────────────────────────────────────────

function chunkText(text, size = 600, overlap = 60) {
  const words = text.split(/\s+/);
  const chunks = [];

  for (let i = 0; i < words.length; i += size - overlap) {
    chunks.push(words.slice(i, i + size).join(' '));
  }

  return chunks;
}