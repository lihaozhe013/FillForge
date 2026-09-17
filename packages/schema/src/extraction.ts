import { z } from 'zod';
import type { FieldDefinitions } from './field.ts';

export const EXTRACTION_STATUS_VALUES = ['found', 'not_found', 'ambiguous'] as const;

export const extractionStatusSchema = z.enum(EXTRACTION_STATUS_VALUES);

export type ExtractionStatus = z.output<typeof extractionStatusSchema>;

export const extractedFieldSchema = z.object({
  value: z.unknown(),
  status: extractionStatusSchema,
  evidence: z.string().nullable()
});

export type ExtractedField = z.output<typeof extractedFieldSchema>;

export const extractionResultSchema = z.record(z.string(), extractedFieldSchema);

export type ExtractionResult = z.output<typeof extractionResultSchema>;

export const EXTRACTION_SCHEMA_VERSION = 1;

export const persistedExtractionSchema = z.object({
  schema_version: z.literal(EXTRACTION_SCHEMA_VERSION),
  result: extractionResultSchema
});

export type PersistedExtraction = z.output<typeof persistedExtractionSchema>;

/**
 * The provider-neutral schema passed to a future direct extractor. The MVP
 * builds the same information into a prompt without invoking a provider.
 */
export interface ExtractionSchema {
  schema_version: number;
  prompt_version: string;
  fields: FieldDefinitions;
}

export const PROMPT_VERSION = 'fillforge-extraction-v1';
