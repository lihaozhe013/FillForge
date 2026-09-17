import { z } from 'zod';

export const appConfigSchema = z.object({
  schema_version: z.literal(1),
  ui: z
    .object({
      theme: z.enum(['system', 'light', 'dark'])
    })
    .partial()
    .optional(),
  editor: z
    .object({
      show_advanced_fields: z.boolean()
    })
    .partial()
    .optional(),
  extraction: z
    .object({
      prompt_version: z.string().min(1).max(100)
    })
    .partial()
    .optional()
});

export type AppConfig = z.output<typeof appConfigSchema>;

export interface ResolvedAppConfig {
  theme: 'system' | 'light' | 'dark';
  showAdvancedFields: boolean;
  promptVersion: string;
}

export function resolveAppConfig(config: AppConfig): ResolvedAppConfig {
  return {
    theme: config.ui?.theme ?? 'system',
    showAdvancedFields: config.editor?.show_advanced_fields ?? false,
    promptVersion: config.extraction?.prompt_version ?? 'fillforge-extraction-v1'
  };
}
