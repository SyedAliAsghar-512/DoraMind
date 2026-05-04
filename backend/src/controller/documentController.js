import { Document } from '../models/Document.js';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { createRequire } from 'module';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from 'canvas';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

// ✅ IMPORTANT: Fix PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();

const MAX_FILE_SIZE   = 20 * 1024 * 1024;
const MAX_TEXT_SIZE   = 10 * 1024 * 1024;
const MAX_PDF_PAGES   = 6;
const PDF_IMAGE_SCALE = 1.5;

const IMAGE_TYPES = new Set([
  'image/jpeg','image/jpg','image/png','image/gif',
  'image/webp','image/bmp','image/svg+xml'
]);

const TEXT_TYPES = new Set([
  'text/plain','text/markdown','text/csv','application/json',
  'text/html','application/javascript','text/css','application/xml'
]);

// ─────────────────────────────────────────────

export async function getDocuments(req, res) {
  const docs = await Document.find({ userId: req.userId })
    .select('-fileChunks -imageBase64')
    .sort({ uploadedAt: -1 });

  res.json({ documents: docs });
}

// ─────────────────────────────────────────────

export async function uploadDocument(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  const { originalname, mimetype, size, buffer } = req.file;

  if (size > MAX_FILE_SIZE) {
    return res.status(413).json({ error: 'File too large (20MB max)' });
  }

  const ext = originalname.split('.').pop()?.toLowerCase() || '';
  const isImage = IMAGE_TYPES.has(mimetype);
  const isPdf   = mimetype === 'application/pdf' || ext === 'pdf';
  const isWord  = ext === 'docx' || ext === 'doc';
  const isPpt   = ext === 'pptx' || ext === 'ppt';
  const isText  = TEXT_TYPES.has(mimetype);

  let textContent = '';
  let fileChunks  = [];
  let extractedImages = [];
  let imageBase64 = null;
  let extractionError = null;

  try {
    if (isImage) {
      imageBase64 = buffer.toString('base64');
      textContent = `[Image: ${originalname}]`;
      fileChunks  = [textContent];
    }

    else if (isPdf) {
      textContent = await extractPdfText(buffer);
      fileChunks  = chunkText(textContent);
      extractedImages = await renderPdfToImages(buffer, originalname);
    }

    else if (isWord) {
      textContent = await extractDocxText(buffer);
      fileChunks  = chunkText(textContent);
    }

    else if (isPpt) {
      textContent = await extractPptxText(buffer);
      fileChunks  = chunkText(textContent);
    }

    else if (isText) {
      textContent = buffer.toString('utf-8');
      fileChunks  = chunkText(textContent);
    }

  } catch (err) {
    extractionError = err.message;
  }

  const doc = await Document.create({
    userId: req.userId,
    filename: originalname,
    mimeType: mimetype,
    sizeBytes: size,
    fileChunks,
    imageBase64,
    isImage,
    processed: true,
    extractionError
  });

  // Save extracted images separately
  let imageDocs = [];
  if (extractedImages.length > 0) {
    imageDocs = await Document.insertMany(
      extractedImages.map(img => ({
        userId: req.userId,
        filename: img.filename,
        mimeType: img.mediaType,
        imageBase64: img.base64,
        isImage: true,
        processed: true,
        fileChunks: [`[Image extracted from ${originalname}]`]
      }))
    );
  }

  res.json({
    document: doc,
    documents: [doc, ...imageDocs]
  });
}

// ─────────────────────────────────────────────

export async function deleteDocument(req, res) {
  await Document.deleteOne({ _id: req.params.docId, userId: req.userId });
  res.json({ ok: true });
}

export async function getDocumentChunks(req, res) {
  const doc = await Document.findById(req.params.docId);
  res.json(doc);
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

// ✅ Option A (safe): keep pdf-parse
async function extractPdfText(buffer) {
  const data = await pdfParse(buffer);
  return data.text || '';
}

// ✅ Option B (better performance)
// Uncomment to replace above
/*
async function extractPdfText(buffer) {
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let text = '';

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(i => i.str).join(' ') + '\n';
  }

  return text;
}
*/

async function renderPdfToImages(buffer, name) {
  const images = [];
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;

  const total = Math.min(pdf.numPages, MAX_PDF_PAGES);

  for (let i = 1; i <= total; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: PDF_IMAGE_SCALE });

    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');

    await page.render({ canvasContext: ctx, viewport }).promise;

    const img = canvas.toBuffer('image/png');

    images.push({
      base64: img.toString('base64'),
      mediaType: 'image/png',
      filename: `${name}_page_${i}.png`
    });
  }

  return images;
}

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

function chunkText(text, size = 600, overlap = 60) {
  const words = text.split(/\s+/);
  const chunks = [];

  for (let i = 0; i < words.length; i += size - overlap) {
    chunks.push(words.slice(i, i + size).join(' '));
  }

  return chunks;
}