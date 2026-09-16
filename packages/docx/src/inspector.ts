import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { DocxInspectionError } from "./errors.ts";
import type { TemplateInspection } from "./renderer.ts";

/**
 * Normalize a raw Docxtemplater tag into a placeholder key.
 * Loop markers (#items, /items, ^items) are not simple placeholders; filters
 * (tag | uppercase) keep only the tag part.
 */
export function normalizeTag(rawTag: string): string | null {
  const tag = rawTag.trim();
  if (!tag || /^[#/^]/.test(tag)) {
    return null;
  }
  const withoutFilters = tag.split("|")[0]?.trim() ?? "";
  return withoutFilters || null;
}

export function describeDocxtemplaterError(error: unknown): {
  message: string;
  details: unknown;
} {
  const properties = (error as { properties?: { errors?: unknown[] } })?.properties;
  const errors = properties?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const explanations = errors
      .map((issue) => {
        const props = issue as {
          explanation?: string;
          id?: string;
          properties?: { id?: string; explanation?: string };
        };
        return (
          props.properties?.explanation ??
          props.properties?.id ??
          props.explanation ??
          props.id ??
          "Unknown template error"
        );
      })
      .join("; ");
    return { message: explanations, details: errors };
  }
  const message = error instanceof Error ? error.message : "Unknown DOCX template error";
  return { message, details: undefined };
}

/**
 * Discover placeholders in a DOCX template.
 *
 * Word is allowed to split visible text across XML runs, so a naive regex
 * over document.xml is unreliable. We let Docxtemplater compile the template
 * (it handles run boundaries) and collect tags through its parser hook.
 */
export function inspectDocxPlaceholders(document: Uint8Array): TemplateInspection {
  const rawTags = new Set<string>();
  try {
    const zip = new PizZip(Buffer.from(document));
    // The constructor compiles the template, which invokes the parser for
    // every tag it finds across XML run boundaries.
    new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      parser: (tag: string) => {
        rawTags.add(tag);
        return { get: () => "" };
      },
    });
  } catch (error) {
    const { message, details } = describeDocxtemplaterError(error);
    throw new DocxInspectionError(`The DOCX template could not be inspected: ${message}`, {
      details,
      cause: error,
    });
  }

  const placeholders = [...rawTags]
    .map((tag) => normalizeTag(tag))
    .filter((tag): tag is string => tag !== null);
  return { placeholders: [...new Set(placeholders)].sort() };
}
