import { AppError, readFileBinary, ValidationError } from '@fillforge/core';
import type { DocumentRenderer } from '@fillforge/docx';
import { TEMPLATE_SCHEMA_VERSION } from '@fillforge/schema';
import type {
  CreateTemplateInput,
  FieldDefinition,
  PlaceholderReport,
  TemplateBinding,
  TemplateSchema,
  TemplateSummary
} from '@fillforge/schema';
import { computePlaceholderReport } from './inspect.ts';
import { collectUnsupportedTags, mergePlaceholderDefaults } from './placeholders.ts';
import { FileTemplateRepository, type TemplateRepository } from './repository.ts';

function requireSupportedPlaceholders(
  inspection: Awaited<ReturnType<DocumentRenderer['inspect']>>
): string[] {
  const unsupportedTags = collectUnsupportedTags(inspection);
  if (unsupportedTags.length > 0) {
    throw new AppError(
      'template_placeholders_unsupported',
      'Use simple lowercase English placeholders such as {invoice_number}.',
      { details: unsupportedTags }
    );
  }
  const placeholders = [...new Set(inspection.placeholders)].sort();
  if (placeholders.length === 0) {
    throw new AppError(
      'template_placeholders_missing',
      'Add at least one placeholder such as {invoice_number} to the DOCX, then import it again.'
    );
  }
  return placeholders;
}

export class TemplateService {
  readonly repository: TemplateRepository;

  private readonly renderer: DocumentRenderer;

  constructor(repository: TemplateRepository, renderer: DocumentRenderer) {
    this.repository = repository;
    this.renderer = renderer;
  }

  static createDefault(templatesDir: string, renderer: DocumentRenderer): TemplateService {
    return new TemplateService(new FileTemplateRepository(templatesDir), renderer);
  }

  listTemplates(): Promise<TemplateSummary[]> {
    return this.repository.list();
  }

  loadTemplate(id: string): Promise<TemplateSchema> {
    return this.repository.load(id);
  }

  async importTemplate(input: CreateTemplateInput): Promise<TemplateSchema> {
    const document = await readFileBinary(input.documentPath);
    const inspection = await this.renderer.inspect(document);
    const placeholders = requireSupportedPlaceholders(inspection);
    const emptyTemplate: TemplateSchema = {
      schema_version: TEMPLATE_SCHEMA_VERSION,
      id: 'placeholder-template',
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      document: { file: 'template.docx' },
      fields: {},
      bindings: {}
    };
    const generated = mergePlaceholderDefaults(emptyTemplate, placeholders).template;
    return this.repository.create({
      ...input,
      fields: generated.fields,
      bindings: generated.bindings
    });
  }

  saveSchema(id: string, schema: TemplateSchema): Promise<void> {
    return this.repository.saveSchema(id, schema);
  }

  async mergeFields(id: string, fields: Record<string, FieldDefinition>): Promise<TemplateSchema> {
    const schema = await this.repository.load(id);
    const merged: TemplateSchema = {
      ...schema,
      fields: { ...schema.fields, ...fields }
    };
    await this.repository.saveSchema(id, merged);
    return merged;
  }

  async mergeBindings(
    id: string,
    bindings: Record<string, TemplateBinding>
  ): Promise<TemplateSchema> {
    const schema = await this.repository.load(id);
    const merged: TemplateSchema = {
      ...schema,
      bindings: { ...(schema.bindings ?? {}), ...bindings }
    };
    await this.repository.saveSchema(id, merged);
    return merged;
  }

  async syncPlaceholders(id: string, draft?: TemplateSchema): Promise<TemplateSchema> {
    const current = draft ?? (await this.repository.load(id));
    if (current.id !== id) {
      throw new ValidationError('Template id does not match the requested template.', {
        requestedId: id,
        schemaId: current.id
      });
    }
    const document = await readFileBinary(await this.repository.getDocumentPath(id));
    const inspection = await this.renderer.inspect(document);
    const placeholders = requireSupportedPlaceholders(inspection);
    const merged = mergePlaceholderDefaults(current, placeholders);
    if (merged.changed || draft !== undefined) {
      await this.repository.saveSchema(id, merged.template);
    }
    return merged.template;
  }

  async inspectTemplate(id: string): Promise<PlaceholderReport> {
    const [schema, documentPath] = await Promise.all([
      this.repository.load(id),
      this.repository.getDocumentPath(id)
    ]);
    const document = await readFileBinary(documentPath);
    const inspection = await this.renderer.inspect(document);
    return computePlaceholderReport(inspection, schema);
  }

  duplicateTemplate(id: string, newId?: string): Promise<TemplateSchema> {
    return this.repository.duplicate(id, newId);
  }

  deleteTemplate(id: string): Promise<void> {
    return this.repository.delete(id);
  }

  getDocumentPath(id: string): Promise<string> {
    return this.repository.getDocumentPath(id);
  }

  async readTemplateDocument(id: string): Promise<Uint8Array> {
    const documentPath = await this.repository.getDocumentPath(id);
    return readFileBinary(documentPath);
  }
}
