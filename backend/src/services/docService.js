import mammoth from 'mammoth';
import JSZip    from 'jszip';

/**
 * Extract plain text from a DOCX buffer using mammoth.
 */
export async function extractDocxText(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

/**
 * Extract plain text from a PPTX buffer using JSZip.
 * Reads only slide XML files and strips all XML tags.
 */
export async function extractPptxText(buffer) {
  const zip        = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort(); // process slides in order

  const texts = await Promise.all(
    slideFiles.map(async (s) => {
      const xml = await zip.files[s].async('text');
      return xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    })
  );

  return texts.filter(Boolean).join('\n');
}
