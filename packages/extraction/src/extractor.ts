import type { ExtractionResult, FieldDefinition } from '@fillforge/schema';

export interface Attachment {
  id: string;
  path: string;
  mediaType: string;
}

export interface ExtractionRequest {
  templateId: string;
  fields: FieldDefinition[];
  attachments: Attachment[];
}

/** Provider-neutral seam for a future direct extraction implementation. */
export interface Extractor {
  extract(request: ExtractionRequest): Promise<ExtractionResult>;
}
