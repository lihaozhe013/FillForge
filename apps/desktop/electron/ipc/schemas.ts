import {
  appLanguageSchema,
  runIdSchema,
  templateIdSchema,
  templateSchema
} from '@fillforge/schema';
import { z } from 'zod';

export const emptyPayloadSchema = z.void();

export const templatesLoadSchema = z.object({ id: templateIdSchema });

export const templatesSaveSchemaSchema = z.object({
  id: templateIdSchema,
  schema: templateSchema
});

export const templatesPromptPreviewSchema = z.object({ id: templateIdSchema });

export const runsCreateSchema = z.object({ templateId: templateIdSchema }).strict();

export const runsLoadSchema = z.object({ id: runIdSchema });

export const runsImportExtractionSchema = z.object({
  id: runIdSchema,
  raw: z.string().min(1).max(2_000_000)
});

export const runsSaveReviewSchema = z.object({
  id: runIdSchema,
  finalValues: z.record(z.string(), z.unknown())
});

export const settingsSaveSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  language: appLanguageSchema,
  showAdvancedFields: z.boolean(),
  promptVersion: z.string().trim().min(1).max(100)
});

export const systemPathSchema = z.object({
  path: z.string().min(1)
});
