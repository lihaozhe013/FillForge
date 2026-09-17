import { REVIEW_SCHEMA_VERSION } from '@fillforge/schema';
import type {
  ExtractionResult,
  ReviewDecision,
  ReviewedField,
  ReviewedRecord
} from '@fillforge/schema';

/**
 * Decide the review decision from the model value and the human value.
 * The original model value is never overwritten; it is kept as model_value.
 */
export function decideReviewDecision(modelValue: unknown, finalValue: unknown): ReviewDecision {
  const modelEmpty = modelValue === null || modelValue === undefined;
  const finalEmpty = finalValue === null || finalValue === undefined;
  if (modelEmpty && !finalEmpty) {
    return 'filled_manually';
  }
  if (!modelEmpty && finalEmpty) {
    return 'rejected';
  }
  if (JSON.stringify(modelValue) === JSON.stringify(finalValue)) {
    return 'accepted';
  }
  return 'corrected';
}

/**
 * Build the review record from an extraction result plus the values the
 * human confirmed. Keys without an entry in finalValues keep the model value.
 */
export function buildReviewRecord(
  extraction: ExtractionResult,
  finalValues: Record<string, unknown>,
  fieldKeys: Iterable<string> = []
): ReviewedRecord {
  const fields: Record<string, ReviewedField> = {};
  const keys = new Set([...Object.keys(extraction), ...Object.keys(finalValues), ...fieldKeys]);
  for (const key of keys) {
    const extracted = extraction[key];
    const modelValue = extracted?.value ?? null;
    const finalValue = Object.hasOwn(finalValues, key) ? finalValues[key] : modelValue;
    fields[key] = {
      model_value: modelValue,
      final_value: finalValue === undefined ? null : finalValue,
      decision: decideReviewDecision(modelValue, finalValue)
    };
  }
  return { schema_version: REVIEW_SCHEMA_VERSION, fields };
}

/**
 * The values that flow into normalization: the reviewed final value when a
 * review exists, otherwise the original model value. Null values are skipped.
 */
export function getEffectiveValues(
  extraction: ExtractionResult,
  review: ReviewedRecord | null
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(extraction), ...Object.keys(review?.fields ?? {})]);
  for (const key of keys) {
    const extracted = extraction[key];
    const reviewed = review?.fields[key];
    const value =
      reviewed && Object.hasOwn(reviewed, 'final_value') ? reviewed.final_value : extracted?.value;
    if (value !== null && value !== undefined) {
      values[key] = value;
    }
  }
  return values;
}
