import type { TemplateInspection } from '@fillforge/docx';
import type { PlaceholderReport, TemplateSchema } from '@fillforge/schema';

/**
 * Compare discovered DOCX placeholders with the template configuration.
 * Bindings define which placeholder maps to which field, so:
 * - a placeholder without a binding entry is "unconfigured";
 * - a field that no binding references is "unreferenced".
 */
export function computePlaceholderReport(
  inspection: TemplateInspection,
  schema: TemplateSchema
): PlaceholderReport {
  const bindings = schema.bindings ?? {};
  const fieldKeys = new Set(Object.keys(schema.fields));
  const placeholders = new Set(inspection.placeholders);
  const referencedSources = new Set(
    Object.entries(bindings)
      .filter(([placeholder]) => placeholders.has(placeholder))
      .map(([, binding]) => binding.source)
  );
  return {
    placeholders: inspection.placeholders,
    unconfigured: inspection.placeholders.filter(
      (placeholder) => !Object.hasOwn(bindings, placeholder)
    ),
    unreferenced: [...fieldKeys].filter((field) => !referencedSources.has(field)).sort()
  };
}
