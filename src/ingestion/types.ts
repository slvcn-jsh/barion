export type SourceAssetInput = {
  name: string;
  uri: string;
  mimeType?: string | null;
  size?: number | null;
  file?: Blob | null;
};

export type ExtractedPage = {
  locator: string;
  text: string;
};

export type ParsedSegment = {
  id: string;
  locator: string;
  sectionPath: string;
  text: string;
  startOffset: number;
  endOffset: number;
};

export class SourceActionRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourceActionRequiredError';
  }
}
