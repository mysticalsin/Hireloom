import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';

// Client-side PDF text extraction — the file is parsed entirely in the browser,
// so a user's CV never leaves their machine to be read. The worker is resolved
// through Vite's asset pipeline (import.meta.url) so the bundled hash matches.
GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export async function extractPdfText(file: File): Promise<string> {
  const data = await file.arrayBuffer();
  const task = getDocument({ data });
  const pdf = await task.promise;
  try {
    const blocks: string[] = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      // Items are TextItem | TextMarkedContent; only TextItem carries `str`.
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text) blocks.push(text);
    }
    return blocks.join('\n\n');
  } finally {
    await task.destroy(); // frees the document + worker resources
  }
}
