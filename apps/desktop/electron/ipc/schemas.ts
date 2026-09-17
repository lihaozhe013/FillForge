import { templateIdSchema, templateSchema } from '@docufill/schema';
import { z } from 'zod';

export const emptyPayloadSchema = z.void();

export const templatesLoadSchema = z.object({ id: z.string().min(1) });

export const templatesSaveSchemaSchema = z.object({
  id: z.string().min(1),
  schema: templateSchema
});

export const templatesPromptPreviewSchema = z.object({ id: templateIdSchema });

export const runsCreateSchema = z.object({
  templateId: z.string().min(1),
  attachmentPaths: z.array(z.string().min(1)).default([])
});

export const runsLoadSchema = z.object({ id: z.string().min(1) });

export const runsImportExtractionSchema = z.object({
  id: z.string().min(1),
  raw: z.string().min(1).max(2_000_000)
});

export const runsSaveReviewSchema = z.object({
  id: z.string().min(1),
  finalValues: z.record(z.string(), z.unknown())
});

export const systemPathSchema = z.object({
  path: z.string().min(1)
});
