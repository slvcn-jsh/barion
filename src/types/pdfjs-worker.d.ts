declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown;
}

declare module 'pdfjs-dist/build/pdf.mjs' {
  export function getDocument(options: Record<string, unknown>): {
    promise: Promise<{
      numPages: number;
      getPage(pageNumber: number): Promise<{
        getTextContent(): Promise<{
          items: Array<{ str?: string; hasEOL?: boolean }>;
        }>;
      }>;
    }>;
    destroy(): Promise<void>;
  };
}
