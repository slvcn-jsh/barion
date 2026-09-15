import { SourceActionRequiredError, type ExtractedPage, type SourceAssetInput } from './types';

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_PDF_PAGES = 160;

export async function readSourceAsset(asset: SourceAssetInput): Promise<ExtractedPage[]> {
  const bytes = await readBytes(asset);

  if (isPdf(asset)) {
    if (bytes.byteLength > MAX_PDF_BYTES) {
      throw new SourceActionRequiredError('This PDF is larger than 30 MB. Split it into smaller chapters and import them separately.');
    }

    return extractPdfPages(bytes);
  }

  if (!isPlainText(asset)) {
    throw new SourceActionRequiredError(
      'This file type is saved, but local extraction currently supports PDF, plain text, and Markdown.',
    );
  }

  return [{ locator: 'Document', text: new TextDecoder().decode(bytes) }];
}

async function readBytes(asset: SourceAssetInput) {
  try {
    if (asset.file) {
      return await asset.file.arrayBuffer();
    }

    const response = await fetch(asset.uri);
    if (!response.ok) {
      throw new Error(`Unable to read file (${response.status})`);
    }
    return response.arrayBuffer();
  } catch {
    throw new SourceActionRequiredError(
      'The browser no longer has access to this local file. Please import the original file again.',
    );
  }
}

async function extractPdfPages(buffer: ArrayBuffer): Promise<ExtractedPage[]> {
  await import('pdfjs-dist/build/pdf.worker.mjs');
  const { getDocument } = await import('pdfjs-dist/build/pdf.mjs');
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
    useWorkerFetch: false,
    verbosity: 0,
  });

  try {
    const document = await loadingTask.promise;
    if (document.numPages > MAX_PDF_PAGES) {
      throw new SourceActionRequiredError(
        `This PDF has ${document.numPages} pages. Import a chapter of ${MAX_PDF_PAGES} pages or fewer for a focused deck.`,
      );
    }

    const pages: ExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = structurePdfText(content.items as PdfTextItem[])
        .replace(/[ \t]+\n/g, '\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      if (text) {
        pages.push({ locator: `Page ${pageNumber}`, text });
      }
    }

    if (!pages.length) {
      throw new SourceActionRequiredError(
        'No selectable text was found. This appears to be a scanned PDF and needs OCR before Barion can create drafts.',
      );
    }

    return pages;
  } catch (error) {
    if (error instanceof SourceActionRequiredError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'The PDF could not be read.';
    if (/password/i.test(message)) {
      throw new SourceActionRequiredError('This PDF is password protected. Remove the password and import it again.');
    }
    throw new Error(message);
  } finally {
    await loadingTask.destroy();
  }
}

type PdfTextItem = {
  str?: string;
  hasEOL?: boolean;
  height?: number;
  transform?: number[];
};

function structurePdfText(items: PdfTextItem[]) {
  const readable = items.filter((item) => item.str?.trim());
  const sizes = readable
    .map((item) => Math.abs(item.height ?? item.transform?.[3] ?? 0))
    .filter((size) => size > 0)
    .sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] || 11;
  let output = '';
  let previous: PdfTextItem | undefined;

  for (const item of readable) {
    const value = item.str?.trim();
    if (!value) continue;

    const size = Math.abs(item.height ?? item.transform?.[3] ?? bodySize);
    const isHeading = size >= bodySize * 1.3 && value.length <= 120;
    const currentY = item.transform?.[5];
    const previousY = previous?.transform?.[5];
    const verticalGap = currentY !== undefined && previousY !== undefined
      ? Math.abs(previousY - currentY)
      : 0;

    if (output) {
      if (isHeading || verticalGap > bodySize * 1.8) output += '\n\n';
      else if (previous?.hasEOL || verticalGap > bodySize * 0.45) output += '\n';
      else output += ' ';
    }

    output += isHeading ? `# ${value}` : value;
    if (isHeading) output += '\n\n';
    previous = item;
  }

  return output;
}

function isPdf(asset: SourceAssetInput) {
  return asset.mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf');
}

function isPlainText(asset: SourceAssetInput) {
  const name = asset.name.toLowerCase();
  return (
    asset.mimeType?.startsWith('text/') ||
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    name.endsWith('.markdown')
  );
}
