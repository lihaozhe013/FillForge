import type { ExtractionResult, FieldDefinition, TemplateSchema } from '@fillforge/schema';
import { formatDate, normalizeFieldValue, parseDateParts } from './normalizer.ts';

export interface ExtractionIssue {
  field: string;
  code: string;
  message: string;
}

export interface ValidateValueOptions {
  normalizeBeforeValidation?: boolean;
}

function isBlank(value: unknown): boolean {
  return (
    value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
  );
}

function checkValueType(
  key: string,
  field: FieldDefinition,
  value: unknown
): ExtractionIssue | null {
  if (isBlank(value)) {
    return null;
  }

  const actual = typeof value;
  const expected = field.type;
  const valid =
    (expected === 'string' && actual === 'string') ||
    (expected === 'number' && actual === 'number' && Number.isFinite(value)) ||
    (expected === 'boolean' && actual === 'boolean') ||
    (expected === 'date' && actual === 'string');

  if (valid) {
    return null;
  }

  return {
    field: key,
    code: 'type_mismatch',
    message: `Field "${key}" should be a ${expected}, but received ${actual === 'string' ? `"${String(value).slice(0, 40)}"` : actual}.`
  };
}

function ruleIssue(field: string, message: string): ExtractionIssue {
  return { field, code: 'rule_violation', message };
}

function dateMatchesFormat(value: string, format: string): boolean {
  const parts = parseDateParts(value);
  return parts !== null && formatDate(parts, format) === value.trim();
}

function fieldRuleIssues(key: string, field: FieldDefinition, value: unknown): ExtractionIssue[] {
  if (isBlank(value)) {
    return [];
  }

  const rules = field.validation;
  const issues: ExtractionIssue[] = [];

  if (field.type === 'date' && typeof value === 'string' && !parseDateParts(value)) {
    issues.push({
      field: key,
      code: 'invalid_date',
      message: `Field "${key}" is not a valid calendar date.`
    });
  }

  if (!rules) {
    return issues;
  }

  if (rules.regex !== undefined) {
    try {
      if (!new RegExp(rules.regex).test(String(value))) {
        issues.push(ruleIssue(key, `Field "${key}" must match the pattern ${rules.regex}.`));
      }
    } catch {
      issues.push({
        field: key,
        code: 'invalid_validation_rule',
        message: `Field "${key}" has an invalid regular expression rule.`
      });
    }
  }

  if (rules.minimum !== undefined || rules.maximum !== undefined) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) {
      if (rules.minimum !== undefined && numeric < rules.minimum) {
        issues.push(ruleIssue(key, `Field "${key}" must be at least ${rules.minimum}.`));
      }
      if (rules.maximum !== undefined && numeric > rules.maximum) {
        issues.push(ruleIssue(key, `Field "${key}" must be at most ${rules.maximum}.`));
      }
    }
  }

  if (rules.date_format !== undefined && typeof value === 'string') {
    if (!dateMatchesFormat(value, rules.date_format)) {
      issues.push(ruleIssue(key, `Field "${key}" must use the date format ${rules.date_format}.`));
    }
  }

  if (rules.enum !== undefined && !rules.enum.includes(String(value))) {
    issues.push(ruleIssue(key, `Field "${key}" must be one of: ${rules.enum.join(', ')}.`));
  }

  return issues;
}

export function validateFieldValue(
  key: string,
  field: FieldDefinition,
  value: unknown,
  options: ValidateValueOptions = {}
): ExtractionIssue[] {
  const candidate = options.normalizeBeforeValidation ? normalizeFieldValue(field, value) : value;

  if (isBlank(candidate)) {
    return field.required
      ? [
          {
            field: key,
            code: 'required_value_missing',
            message: `Required field "${key}" (${field.label}) has no value.`
          }
        ]
      : [];
  }

  const typeIssue = checkValueType(key, field, candidate);
  return typeIssue ? [typeIssue] : fieldRuleIssues(key, field, candidate);
}

function unknownFieldIssues(
  values: Record<string, unknown>,
  template: TemplateSchema
): ExtractionIssue[] {
  return Object.keys(values)
    .filter((key) => !Object.hasOwn(template.fields, key))
    .map((key) => ({
      field: key,
      code: 'unknown_field',
      message: `Field "${key}" is not configured in template "${template.id}".`
    }));
}

/** Validate normalized business values immediately before document rendering. */
export function validateBusinessValues(
  values: Record<string, unknown>,
  template: TemplateSchema
): ExtractionIssue[] {
  const issues = unknownFieldIssues(values, template);
  for (const [key, field] of Object.entries(template.fields)) {
    issues.push(...validateFieldValue(key, field, values[key] ?? null));
  }
  return issues;
}

/** Validate editable review values while allowing the configured coercions. */
export function validateReviewedValues(
  values: Record<string, unknown>,
  template: TemplateSchema
): ExtractionIssue[] {
  const issues = unknownFieldIssues(values, template);
  for (const [key, field] of Object.entries(template.fields)) {
    issues.push(
      ...validateFieldValue(key, field, values[key] ?? null, { normalizeBeforeValidation: true })
    );
  }
  return issues;
}

/** Validate the provider-neutral extraction contract against template semantics. */
export function validateExtractionResult(
  result: ExtractionResult,
  template: TemplateSchema
): ExtractionIssue[] {
  const issues = unknownFieldIssues(
    Object.fromEntries(Object.keys(result).map((key) => [key, result[key]])),
    template
  );

  for (const [key, field] of Object.entries(template.fields)) {
    const extracted = result[key];
    if (!extracted) {
      if (field.required) {
        issues.push({
          field: key,
          code: 'missing_field',
          message: `Required field "${key}" is missing from the extraction result.`
        });
      }
      continue;
    }

    if (extracted.status === 'not_found' || extracted.status === 'ambiguous') {
      if (!isBlank(extracted.value)) {
        issues.push({
          field: key,
          code: 'status_value_conflict',
          message: `Field "${key}" has status "${extracted.status}" but a non-empty value.`
        });
      }
      if (field.required) {
        issues.push({
          field: key,
          code: extracted.status === 'not_found' ? 'required_not_found' : 'required_ambiguous',
          message: `Required field "${key}" was reported as ${extracted.status}.`
        });
      }
      continue;
    }

    issues.push(...validateFieldValue(key, field, extracted.value));
  }

  return issues;
}

export function valueFailsFieldValidation(field: FieldDefinition, value: unknown): boolean {
  return fieldRuleIssues('__value__', field, value).length > 0;
}
