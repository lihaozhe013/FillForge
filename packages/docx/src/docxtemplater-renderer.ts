import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { DocxRenderError } from "./errors.ts";
import { describeDocxtemplaterError, inspectDocxPlaceholders } from "./inspector.ts";
import type { DocumentRenderer, RenderInput, TemplateInspection } from "./renderer.ts";

export class DocxtemplaterRenderer implements DocumentRenderer {
  async inspect(document: Uint8Array): Promise<TemplateInspection> {
    return inspectDocxPlaceholders(document);
  }

  async render(input: RenderInput): Promise<Uint8Array> {
    try {
      const zip = new PizZip(Buffer.from(input.document));
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        // Validation happens before rendering in the run service; this keeps
        // rendering deterministic instead of throwing on leftover tags.
        nullGetter: () => "",
      });
      doc.render(input.values);
      return new Uint8Array(doc.toBuffer());
    } catch (error) {
      const { message, details } = describeDocxtemplaterError(error);
      throw new DocxRenderError(`DOCX rendering failed: ${message}`, {
        details,
        cause: error,
      });
    }
  }
}

export function createDocxtemplaterRenderer(): DocumentRenderer {
  return new DocxtemplaterRenderer();
}
