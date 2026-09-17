import { z } from 'zod';

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

export const PROMPT_VERSION = 'fillforge-extraction-v1';
