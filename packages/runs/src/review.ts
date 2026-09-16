import type {
  ExtractionResult,
  ReviewDecision,
  ReviewedField,
  ReviewedRecord,
} from "@docufill/schema";

/**
 * Decide the review decision from the model value and the human value.
 * The original model value is never overwritten; it is kept as model_value.
 */
export function decideReviewDecision(modelValue: unknown, finalValue: unknown): ReviewDecision {
  const modelEmpty = modelValue === null || modelValue === undefined;
  const finalEmpty = finalValue === null || finalValue === undefined;
  if (modelEmpty && !finalEmpty) {
    return "filled_manually";
  }
  if (!modelEmpty && finalEmpty) {
    return "rejected";
  }
  if (JSON.stringify(modelValue) === JSON.stringify(finalValue)) {
    return "accepted";
  }
  return "corrected";
}

/**
 * Build the review record from an extraction result plus the values the
 * human confirmed. Keys without an entry in finalValues keep the model value.
 */
export function buildReviewRecord(
  extraction: ExtractionResult,
  finalValues: Record<string, unknown>,
): ReviewedRecord {
  const fields: Record<string, ReviewedField> = {};
  for (const [key, extracted] of Object.entries(extraction)) {
    const modelValue = extracted.value === undefined ? null : extracted.value;
    const finalValue = Object.hasOwn(finalValues, key) ? finalValues[key] : modelValue;
    fields[key] = {
      model_value: modelValue,
      final_value: finalValue === undefined ? null : finalValue,
      decision: decideReviewDecision(modelValue, finalValue),
    };
  }
  return { schema_version: 1, fields };
}

/**
 * The values that flow into normalization: the reviewed final value when a
 * review exists, otherwise the original model value. Null values are skipped.
 */
export function getEffectiveValues(
  extraction: ExtractionResult,
  review: ReviewedRecord | null,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, extracted] of Object.entries(extraction)) {
    const reviewed = review?.fields[key];
    const value =
      reviewed && Object.hasOwn(reviewed, "final_value") ? reviewed.final_value : extracted.value;
    if (value !== null && value !== undefined) {
      values[key] = value;
    }
  }
  return values;
}
