import {
  type FieldDefinition,
  type FieldDefinitions,
  PROMPT_VERSION,
  type TemplateSchema,
} from "@docufill/schema";

export interface GeneratedPrompt {
  prompt: string;
  expectedJson: string;
  promptVersion: string;
}

function describeExpectedValue(field: FieldDefinition): string {
  switch (field.type) {
    case "number":
      return "number or null";
    case "boolean":
      return "boolean or null";
    case "date":
      return `date string (${field.output?.format ?? "YYYY-MM-DD"}) or null`;
    default:
      return "string or null";
  }
}

/** Build the "Expected format" JSON block shown to the model and the user. */
export function buildExpectedJson(fields: FieldDefinitions): string {
  const shape: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    shape[key] = {
      value: describeExpectedValue(field),
      status: "found | not_found | ambiguous",
      evidence: "short supporting text or null",
    };
  }
  return JSON.stringify(shape, null, 2);
}

function describeField(key: string, field: FieldDefinition): string {
  const lines = [
    key,
    `Meaning: ${field.label}`,
    `Type: ${field.type}`,
    `Required: ${field.required ? "yes" : "no"}`,
  ];
  if (field.description) {
    lines.push(`Description: ${field.description}`);
  }
  if (field.extraction?.instruction) {
    lines.push("Extraction rule:", field.extraction.instruction.trim());
  }
  return lines.join("\n");
}

/**
 * Build the complete extraction prompt for a template. The output is a pure
 * function of the template configuration and the prompt version; it never
 * depends on UI code, so the same schema always yields the same prompt.
 */
export function buildExtractionPrompt(template: TemplateSchema): GeneratedPrompt {
  const fields = template.fields;
  const fieldKeys = Object.keys(fields);
  if (fieldKeys.length === 0) {
    throw new Error(
      `Template "${template.id}" has no configured fields; configure fields before generating a prompt.`,
    );
  }

  const sections: string[] = [
    "You are a structured document information extractor.",
    "",
    "Inspect the documents/images supplied by the user.",
    "",
    "Extract only the requested fields.",
    "",
    "Do not guess.",
    "",
    "If a field cannot be reliably determined, set its value to null and describe why through the status and evidence fields.",
    "",
    "Requested fields:",
    "",
    fieldKeys.map((key) => describeField(key, fields[key])).join("\n\n"),
    "",
    "For every field, determine one status: found, not_found, or ambiguous.",
    "",
    "Return valid JSON only, with no commentary before or after it.",
    "",
    "Expected format:",
    "",
    buildExpectedJson(fields),
  ];

  return {
    prompt: `${sections.join("\n")}\n`,
    expectedJson: buildExpectedJson(fields),
    promptVersion: PROMPT_VERSION,
  };
}
