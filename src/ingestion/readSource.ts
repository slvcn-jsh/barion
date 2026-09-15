import type { ExtractedPage, SourceAssetInput } from './types';

// Metro resolves readSource.web.ts or readSource.native.ts before this fallback.
export async function readSourceAsset(_asset: SourceAssetInput): Promise<ExtractedPage[]> {
  throw new Error('No source reader is available for this platform.');
}
