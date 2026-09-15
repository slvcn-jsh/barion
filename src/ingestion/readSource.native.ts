import { File } from 'expo-file-system';

import { SourceActionRequiredError, type ExtractedPage, type SourceAssetInput } from './types';

export async function readSourceAsset(asset: SourceAssetInput): Promise<ExtractedPage[]> {
  if (isPdf(asset)) {
    return extractPdfWithService(asset);
  }

  if (!isPlainText(asset)) {
    throw new SourceActionRequiredError(
      'This file type is saved safely, but local extraction currently supports PDF, plain text, and Markdown.',
    );
  }

  const source = new File(asset.uri);
  if (!source.exists) {
    throw new SourceActionRequiredError('The selected file is no longer available. Please import it again.');
  }

  const text = await source.text();
  return [{ locator: 'Document', text }];
}

async function extractPdfWithService(asset: SourceAssetInput) {
  const serviceUrl = process.env.EXPO_PUBLIC_BARION_INGESTION_URL?.replace(/\/$/, '');
  if (!serviceUrl) {
    throw new SourceActionRequiredError(
      'PDF extraction is not configured for this mobile build. Use Barion Web, or configure the private Barion ingestion service and try again.',
    );
  }

  const form = new FormData();
  form.append('file', {
    name: asset.name,
    type: asset.mimeType || 'application/pdf',
    uri: asset.uri,
  } as unknown as Blob);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(`${serviceUrl}/v1/extract`, {
      body: form,
      method: 'POST',
      signal: controller.signal,
    });
    const result = await response.json() as { detail?: string; pages?: ExtractedPage[] };
    if (!response.ok) {
      throw new SourceActionRequiredError(result.detail || 'The PDF extraction service could not read this file.');
    }
    if (!result.pages?.length) {
      throw new SourceActionRequiredError('No selectable text was returned for this PDF. It may need OCR.');
    }
    return result.pages;
  } catch (error) {
    if (error instanceof SourceActionRequiredError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SourceActionRequiredError('PDF extraction timed out. Check the service connection and try again.');
    }
    throw new SourceActionRequiredError('Barion could not reach the configured PDF extraction service.');
  } finally {
    clearTimeout(timeout);
  }
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
