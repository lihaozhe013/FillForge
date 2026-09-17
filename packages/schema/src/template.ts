import { z } from 'zod';
import { fieldDefinitionSchema } from './field.ts';

export const templateIdSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, {
  message: 'Template id must be a stable machine identifier (lowercase snake_case)'
});

export const bindingSchema = z.object({
  source: z.string().min(1),
  transform: z.string().optional()
});

export type TemplateBinding = z.output<typeof bindingSchema>;

export const TEMPLATE_SCHEMA_VERSION = 1;

export const templateSchema = z.object({
  schema_version: z.literal(TEMPLATE_SCHEMA_VERSION),
  id: templateIdSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  document: z.object({
    file: z.string().min(1)
  }),
  fields: z.record(z.string(), fieldDefinitionSchema),
  bindings: z.record(z.string(), bindingSchema).optional()
});

export type TemplateSchema = z.output<typeof templateSchema>;

export interface TemplateSummary {
  id: string;
  name: string;
  description?: string;
  hasDocument: boolean;
}

export interface CreateTemplateInput {
  id?: string;
  name: string;
  description?: string;
  documentPath: string;
}

export interface PlaceholderReport {
  placeholders: string[];
  unconfigured: string[];
  unreferenced: string[];
}
