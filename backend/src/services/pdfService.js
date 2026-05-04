import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from 'canvas';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const MAX_PDF_PAGES  = 3;
const PDF_IMAGE_SCALE = 1.2;

pdfjsLib.GlobalWorkerOptions.workerSrc =
  new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();

/**
 * Extract plain text from all pages (up to MAX_PDF_PAGES) of a PDF buffer.
 * Uses parallel page processing for speed.
 */
export async function extractPdfText(buffer) {
  const pdf   = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const total = Math.min(pdf.numPages, MAX_PDF_PAGES);

  const pages = await Promise.all(
    Array.from({ length: total }, async (_, i) => {
      const page    = await pdf.getPage(i + 1);
      const content = await page.getTextContent();
      return content.items.map(item => item.str).join(' ');
    })
  );

  return pages.join('\n');
}

/**
 * Render PDF pages as PNG images saved to the filesystem.
 * Returns an array of absolute file paths.
 *
 * @param {Buffer} buffer
 * @param {string} docId  - MongoDB document _id string (used as subdirectory)
 * @returns {Promise<string[]>} absolute paths to saved PNG files
 */
export async function renderPdfToImages(buffer, docId) {
  const uploadsDir = process.env.UPLOADS_DIR || path.resolve('uploads');
  const docDir     = path.join(uploadsDir, docId.toString());
  await mkdir(docDir, { recursive: true });

  const pdf   = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  const total = Math.min(pdf.numPages, MAX_PDF_PAGES);

  const tasks = Array.from({ length: total }, async (_, i) => {
    const page     = await pdf.getPage(i + 1);
    const viewport = page.getViewport({ scale: PDF_IMAGE_SCALE });
    const canvas   = createCanvas(viewport.width, viewport.height);

    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    const filePath = path.join(docDir, `page_${i + 1}.png`);
    await writeFile(filePath, canvas.toBuffer('image/png'));
    return filePath;
  });

  return Promise.all(tasks);
}
