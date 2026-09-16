import type { ExtractionResult, FieldDefinition, TemplateSchema } from "@docufill/schema";

export interface ExtractionIssue {
  field: string;
  code: string;
  message: string;
}

function checkValueType(
  key: string,
  field: FieldDefinition,
  value: unknown,
): ExtractionIssue | null {
  if (value === null || value === undefined) {
    return null;
  }
  const expected = field.type;
  const actual = typeof value;
  const ok =
    (expected === "string" && actual === "string") ||
    (expected === "number" && actual === "number" && Number.isFinite(value)) ||
    (expected === "boolean" && actual === "boolean") ||
    // Dates travel as strings; the exact format is normalized later.
    (expected === "date" && actual === "string");
  if (!ok) {
    return {
      field: key,
      code: "type_mismatch",
      message: `Field "${key}" should be a ${expected}, but received ${actual === "string" ? `"${String(value).slice(0, 40)}"` : actual}.`,
    };
  }
  return null;
}

/**
 * Validate an AI extraction result against a template configuration.
 * Structural validation already happened in the parser; this checks the
 * result against the template's business fields and rules.
 */
export function validateExtractionResult(
  result: ExtractionResult,
  template: TemplateSchema,
): ExtractionIssue[] {
  const issues: ExtractionIssue[] = [];
  const fields = template.fields;

  for (const key of Object.keys(result)) {
    if (!Object.hasOwn(fields, key)) {
      issues.push({
        field: key,
        code: "unknown_field",
        message: `Field "${key}" is not configured in template "${template.id}".`,
      });
    }
  }

  for (const [key, field] of Object.entries(fields)) {
    const extracted = result[key];
    if (!extracted) {
      if (field.required) {
        issues.push({
          field: key,
          code: "missing_field",
          message: `Required field "${key}" is missing from the extraction result.`,
        });
      }
      continue;
    }

    if (extracted.status === "not_found" || extracted.status === "ambiguous") {
      if (field.required && extracted.value !== null) {
        issues.push({
          field: key,
          code: "status_value_conflict",
          message: `Field "${key}" has status "${extracted.status}" but a non-null value.`,
        });
      }
      if (extracted.status === "not_found" && field.required) {
        issues.push({
          field: key,
          code: "required_not_found",
          message: `Required field "${key}" was not found in the source material.`,
        });
      }
      continue;
    }

    const typeIssue = checkValueType(key, field, extracted.value);
    if (typeIssue) {
      issues.push(typeIssue);
      continue;
    }

    if (valueFailsFieldValidation(field, extracted.value)) {
      issues.push({
        field: key,
        code: "rule_violation",
        message: describeRuleViolation(key, field),
      });
    }
  }

  return issues;
}

export function valueFailsFieldValidation(field: FieldDefinition, value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  const rules = field.validation;
  if (!rules) {
    return false;
  }
  if (rules.regex !== undefined) {
    const text = typeof value === "string" ? value : String(value);
    if (!new RegExp(rules.regex).test(text)) {
      return true;
    }
  }
  if (rules.minimum !== undefined || rules.maximum !== undefined) {
    const numeric = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(numeric)) {
      if (rules.minimum !== undefined && numeric < rules.minimum) {
        return true;
      }
      if (rules.maximum !== undefined && numeric > rules.maximum) {
        return true;
      }
    }
  }
  if (rules.enum !== undefined && !rules.enum.includes(String(value))) {
    return true;
  }
  return false;
}

function describeRuleViolation(key: string, field: FieldDefinition): string {
  const rules = field.validation;
  if (rules?.regex !== undefined) {
    return `Field "${key}" must match the pattern ${rules.regex}.`;
  }
  if (rules?.minimum !== undefined && rules?.maximum !== undefined) {
    return `Field "${key}" must be between ${rules.minimum} and ${rules.maximum}.`;
  }
  if (rules?.minimum !== undefined) {
    return `Field "${key}" must be at least ${rules.minimum}.`;
  }
  if (rules?.maximum !== undefined) {
    return `Field "${key}" must be at most ${rules.maximum}.`;
  }
  if (rules?.enum !== undefined) {
    return `Field "${key}" must be one of: ${rules.enum.join(", ")}.`;
  }
  return `Field "${key}" violates its validation rules.`;
}
