/**
 * Domain boundary for DOCX engines. Docxtemplater is an implementation
 * detail and its types must not leak through this interface.
 */
export interface TemplateInspection {
  placeholders: string[];
}

export interface RenderInput {
  document: Uint8Array;
  values: Record<string, unknown>;
}

export interface DocumentRenderer {
  inspect(document: Uint8Array): Promise<TemplateInspection>;

  render(input: RenderInput): Promise<Uint8Array>;
}
