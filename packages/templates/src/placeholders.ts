import type { TemplateInspection } from '@fillforge/docx';
import type { TemplateSchema } from '@fillforge/schema';

const SIMPLE_PLACEHOLDER_PATTERN = /^[a-z][a-z0-9_]*$/;

export function collectUnsupportedTags(inspection: TemplateInspection): string[] {
  const unsupported = new Set(inspection.unsupportedTags ?? []);
  for (const placeholder of inspection.placeholders) {
    if (!SIMPLE_PLACEHOLDER_PATTERN.test(placeholder)) {
      unsupported.add(placeholder);
    }
  }
  return [...unsupported].sort();
}

export function mergePlaceholderDefaults(
  template: TemplateSchema,
  placeholders: string[]
): { template: TemplateSchema; changed: boolean } {
  const fields = { ...template.fields };
  const bindings = { ...(template.bindings ?? {}) };
  let changed = false;

  for (const placeholder of new Set(placeholders)) {
    if (!Object.hasOwn(fields, placeholder)) {
      fields[placeholder] = {
        label: placeholder,
        type: 'string',
        required: false
      };
      changed = true;
    }
    if (!Object.hasOwn(bindings, placeholder)) {
      bindings[placeholder] = { source: placeholder };
      changed = true;
    }
  }

  return {
    template: { ...template, fields, bindings },
    changed
  };
}
