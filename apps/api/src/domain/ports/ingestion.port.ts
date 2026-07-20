import type { IngestedDocumentDto } from '@ai-quiz/shared';

export interface IngestionPort {
  fetchMarkdown(requestedUrl: string): Promise<Readonly<IngestedDocumentDto>>;
}

export const INGESTION_PORT = Symbol('IngestionPort');
