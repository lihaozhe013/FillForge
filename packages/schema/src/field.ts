import { z } from "zod";

export const FIELD_TYPES = ["string", "number", "date", "boolean"] as const;

export const fieldTypeSchema = z.enum(FIELD_TYPES);

export type FieldType = z.output<typeof fieldTypeSchema>;

export const fieldExtractionSchema = z.object({
  instruction: z.string(),
});

export const fieldNormalizationSchema = z
  .object({
    trim: z.boolean(),
    remove_spaces: z.boolean(),
  })
  .partial();

export const fieldValidationSchema = z
  .object({
    regex: z.string(),
    minimum: z.number(),
    maximum: z.number(),
    date_format: z.string(),
    enum: z.array(z.string()),
  })
  .partial();

export const fieldOutputSchema = z
  .object({
    format: z.string(),
  })
  .partial();

export const fieldDefinitionSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
  type: fieldTypeSchema.default("string"),
  required: z.boolean().default(true),
  extraction: fieldExtractionSchema.optional(),
  normalization: fieldNormalizationSchema.optional(),
  validation: fieldValidationSchema.optional(),
  output: fieldOutputSchema.optional(),
});

export type FieldDefinition = z.output<typeof fieldDefinitionSchema>;

export type FieldDefinitions = Record<string, FieldDefinition>;

export function isKnownFieldKey(fields: FieldDefinitions, key: string): boolean {
  return Object.hasOwn(fields, key);
}
