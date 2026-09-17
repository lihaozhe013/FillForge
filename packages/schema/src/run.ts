import { z } from 'zod';
import { templateIdSchema } from './template.ts';

export const RUN_SCHEMA_VERSION = 1;

export const runIdSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);

export type RunId = z.output<typeof runIdSchema>;

export const attachmentMetadataSchema = z.object({
  filename: z.string().min(1),
  original_filename: z.string().min(1),
  media_type: z.string().min(1)
});

export type AttachmentMetadata = z.output<typeof attachmentMetadataSchema>;

export const runMetadataSchema = z.object({
  schema_version: z.literal(RUN_SCHEMA_VERSION),
  id: runIdSchema,
  created_at: z.iso.datetime(),
  template_id: templateIdSchema,
  template_schema_version: z.number().int().positive(),
  prompt_version: z.string().min(1),
  attachments: z.array(attachmentMetadataSchema).default([])
});

export type RunMetadata = z.output<typeof runMetadataSchema>;

export interface RunArtifacts {
  prompt: boolean;
  extraction: boolean;
  review: boolean;
  normalized: boolean;
  output: boolean;
}

export type ArtifactKind = 'prompt' | 'extraction' | 'review' | 'normalized' | 'output';

export interface Artifact {
  kind: ArtifactKind;
  path: string;
  immutable: boolean;
}

export interface RunSummary {
  id: string;
  createdAt: string;
  templateId: string;
  artifacts: RunArtifacts;
}

export const REVIEW_SCHEMA_VERSION = 1;

export const reviewDecisionSchema = z.enum([
  'accepted',
  'corrected',
  'rejected',
  'filled_manually'
]);

export type ReviewDecision = z.output<typeof reviewDecisionSchema>;

export const reviewedFieldSchema = z.object({
  model_value: z.unknown(),
  final_value: z.unknown(),
  decision: reviewDecisionSchema
});

export type ReviewedField = z.output<typeof reviewedFieldSchema>;

export const reviewedRecordSchema = z.object({
  schema_version: z.literal(REVIEW_SCHEMA_VERSION),
  fields: z.record(z.string(), reviewedFieldSchema)
});

export type ReviewedRecord = z.output<typeof reviewedRecordSchema>;

export const normalizedRecordSchema = z.object({
  schema_version: z.literal(RUN_SCHEMA_VERSION),
  values: z.record(z.string(), z.unknown())
});

export type NormalizedRecord = z.output<typeof normalizedRecordSchema>;
