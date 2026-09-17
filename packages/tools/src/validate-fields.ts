import { readFileBinary } from '@fillforge/core';
import {
  type ExtractionIssue,
  normalizeValues,
  parseExtractionResult,
  validateExtractionResult
} from '@fillforge/extraction';
import type { AppContext } from './context.ts';

export interface ValidateFieldsOptions {
  /** Also print the normalized business record after validation. */
  normalize?: boolean;
}

/**
 * Validate an extraction JSON file against a template's configuration
 * without touching any run directory.
 */
export async function validateFields(
  context: AppContext,
  templateId: string,
  extractionJsonPath: string,
  options: ValidateFieldsOptions = {}
): Promise<string> {
  const template = await context.templateService.loadTemplate(templateId);
  const raw = await readFileBinary(extractionJsonPath);
  const text = new TextDecoder().decode(raw);
  const result = parseExtractionResult(text);
  const issues: ExtractionIssue[] = validateExtractionResult(result, template);

  if (issues.length === 0) {
    const lines = ['OK: the extraction result satisfies the template configuration.'];
    if (options.normalize) {
      const values: Record<string, unknown> = {};
      for (const [key, extracted] of Object.entries(result)) {
        values[key] = extracted.value;
      }
      lines.push(
        `Normalized values:\n${JSON.stringify(normalizeValues(values, template.fields), null, 2)}`
      );
    }
    return lines.join('\n');
  }

  return [
    `Found ${issues.length} issue(s):`,
    ...issues.map((issue) => `  - [${issue.code}] ${issue.field}: ${issue.message}`)
  ].join('\n');
}
