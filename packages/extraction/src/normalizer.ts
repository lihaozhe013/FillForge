import type { ExtractionResult, FieldDefinition, FieldDefinitions } from '@fillforge/schema';

function applyStringNormalization(value: string, field: FieldDefinition): string {
  let out = value;
  if (field.normalization?.trim) {
    out = out.trim();
  }
  if (field.normalization?.remove_spaces) {
    out = out.replaceAll(' ', '');
  }
  return out;
}

const DATE_INPUT_PATTERN = /^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?$/;

function parseDateParts(value: unknown): [string, string, string] | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = DATE_INPUT_PATTERN.exec(value.trim());
  if (!match?.[1] || !match[2] || !match[3]) {
    return null;
  }
  return [match[1], match[2].padStart(2, '0'), match[3].padStart(2, '0')];
}

export function formatDate(parts: [string, string, string], format: string): string {
  const [year, month, day] = parts;
  return format.replaceAll('YYYY', year).replaceAll('MM', month).replaceAll('DD', day);
}

function applyDateNormalization(value: unknown, field: FieldDefinition): unknown {
  const parts = parseDateParts(value);
  if (!parts) {
    return value;
  }
  return formatDate(parts, field.output?.format ?? 'YYYY-MM-DD');
}

/**
 * Apply a field's normalization rules to an extracted value. Coercion is
 * best-effort and deterministic: values that cannot be normalized are
 * returned unchanged so validation/review can flag them.
 */
export function normalizeFieldValue(field: FieldDefinition, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  switch (field.type) {
    case 'string': {
      if (typeof value !== 'string') {
        return value;
      }
      return applyStringNormalization(value, field);
    }
    case 'number': {
      if (typeof value === 'number') {
        return value;
      }
      if (typeof value === 'string') {
        const text = applyStringNormalization(value, {
          ...field,
          normalization: { trim: true }
        });
        const numeric = Number(text);
        return Number.isFinite(numeric) ? numeric : value;
      }
      return value;
    }
    case 'date': {
      return applyDateNormalization(value, field);
    }
    case 'boolean': {
      if (typeof value === 'boolean') {
        return value;
      }
      if (value === 'true') {
        return true;
      }
      if (value === 'false') {
        return false;
      }
      return value;
    }
  }
}

/**
 * Normalize a plain business-value record (e.g. reviewed values) against the
 * template's field definitions.
 */
export function normalizeValues(
  values: Record<string, unknown>,
  fields: FieldDefinitions
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const field = fields[key];
    if (!field) {
      continue;
    }
    const normalized = normalizeFieldValue(field, value);
    if (normalized !== null && normalized !== undefined) {
      out[key] = normalized;
    }
  }
  return out;
}

/**
 * Turn a validated extraction result into the normalized business record
 * that bindings consume. Fields without a value are omitted.
 */
export function normalizeExtractionResult(
  result: ExtractionResult,
  fields: FieldDefinitions
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, extracted] of Object.entries(result)) {
    values[key] = extracted.value;
  }
  return normalizeValues(values, fields);
}
