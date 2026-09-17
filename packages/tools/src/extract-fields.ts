import { buildExtractionPrompt } from '@fillforge/extraction';
import type { AppContext } from './context.ts';

/**
 * Print the deterministic extraction prompt for a template. Pipe it into a
 * file or copy it into any AI chat together with the source documents.
 */
export async function extractFields(context: AppContext, templateId: string): Promise<string> {
  const template = await context.templateService.loadTemplate(templateId);
  const generated = buildExtractionPrompt(template);
  return `${generated.prompt}\n---\n\nExpected JSON structure:\n\n${generated.expectedJson}\n`;
}
