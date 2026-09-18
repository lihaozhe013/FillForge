import { z } from 'zod';

export const appLanguages = ['en', 'zh-CN'] as const;
export const appLanguageSettingValues = ['system', ...appLanguages] as const;

export const appLanguageSchema = z.enum(appLanguageSettingValues);

export type AppLanguage = (typeof appLanguages)[number];
export type AppLanguageSetting = (typeof appLanguageSettingValues)[number];

export const defaultPromptVersion = 'fillforge-extraction-v1';

export const appConfigSchema = z.object({
  schema_version: z.literal(1),
  ui: z
    .object({
      theme: z.enum(['system', 'light', 'dark']),
      language: appLanguageSchema
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
  language: AppLanguageSetting;
  showAdvancedFields: boolean;
  promptVersion: string;
}

export function resolveAppConfig(config: AppConfig): ResolvedAppConfig {
  return {
    theme: config.ui?.theme ?? 'system',
    language: config.ui?.language ?? 'system',
    showAdvancedFields: config.editor?.show_advanced_fields ?? false,
    promptVersion: config.extraction?.prompt_version ?? defaultPromptVersion
  };
}

/** Map a BCP-47 system locale (e.g. from navigator.language) onto a supported app language. */
export function matchAppLanguage(systemLocale: string): AppLanguage {
  return systemLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function resolveLocale(language: AppLanguageSetting, systemLocale: string): AppLanguage {
  return language === 'system' ? matchAppLanguage(systemLocale) : language;
}
