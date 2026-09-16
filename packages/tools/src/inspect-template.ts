import type { AppContext } from "./context.ts";

/**
 * Print every placeholder found in a template's DOCX, plus configuration
 * gaps. Accepts a template id.
 */
export async function inspectTemplate(context: AppContext, templateId: string): Promise<string> {
  const template = await context.templateService.loadTemplate(templateId);
  const report = await context.templateService.inspectTemplate(templateId);
  const lines = [
    `Template: ${template.name} (${template.id})`,
    `Placeholders (${report.placeholders.length}):`,
    ...report.placeholders.map((placeholder) => `  - ${placeholder}`),
  ];
  if (report.unconfigured.length > 0) {
    lines.push(`Unconfigured placeholders: ${report.unconfigured.join(", ")}`);
  }
  if (report.unreferenced.length > 0) {
    lines.push(`Configured but unreferenced fields: ${report.unreferenced.join(", ")}`);
  }
  return lines.join("\n");
}
