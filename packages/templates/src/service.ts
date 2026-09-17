import { readFileBinary } from '@docufill/core';
import type { DocumentRenderer } from '@docufill/docx';
import type {
  CreateTemplateInput,
  FieldDefinition,
  PlaceholderReport,
  TemplateBinding,
  TemplateSchema,
  TemplateSummary
} from '@docufill/schema';
import { computePlaceholderReport } from './inspect.ts';
import { FileTemplateRepository, type TemplateRepository } from './repository.ts';

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

  importTemplate(input: CreateTemplateInput): Promise<TemplateSchema> {
    return this.repository.create(input);
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
