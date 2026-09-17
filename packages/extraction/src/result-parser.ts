import { ValidationError } from '@fillforge/core';
import { type ExtractionResult, extractionResultSchema } from '@fillforge/schema';
import { ExtractionParseError } from './errors.ts';

/**
 * Strip an obvious Markdown code fence such as:
 *
 * ```json
 * { ... }
 * ```
 *
 * Models frequently wrap JSON output in fences even when asked not to. We do
 * not attempt any more aggressive recovery; malformed JSON must surface as a
 * parse error the user can fix manually.
 */
export function stripMarkdownFences(raw: string): string {
  const text = raw.trim();
  if (!text.startsWith('```')) {
    return text;
  }
  const openingEnd = text.indexOf('\n');
  if (openingEnd < 0) {
    return text;
  }
  const closingStart = text.lastIndexOf('```');
  if (closingStart <= openingEnd) {
    return text;
  }
  return text.slice(openingEnd + 1, closingStart).trim();
}

export function parseExtractionJson(raw: string): ExtractionResult {
  const text = stripMarkdownFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ExtractionParseError(`The pasted extraction result is not valid JSON: ${message}`, {
      cause: error
    });
  }
  const result = extractionResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError(
      'The extraction result does not match the expected structure (fields need value, status, evidence).',
      result.error.issues
    );
  }
  return result.data;
}

export function parseExtractionResult(raw: string): ExtractionResult {
  return parseExtractionJson(raw);
}
