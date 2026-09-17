import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AppError,
  copyFileWithCollisionAvoidance,
  InvalidIdentifierError,
  InvalidTemplateSchemaError,
  isPathInside,
  listSubdirectories,
  pathExists,
  randomSuffix,
  readYamlFile,
  removePath,
  slugifyId,
  TemplateNotFoundError,
  UnsupportedSchemaVersionError,
  ValidationError,
  writeYamlFileAtomic
} from '@fillforge/core';
import {
  type CreateTemplateInput,
  TEMPLATE_SCHEMA_VERSION,
  type TemplateSchema,
  type TemplateSummary,
  templateIdSchema,
  templateSchema
} from '@fillforge/schema';

const TEMPLATE_CONFIG_FILE = 'template.yaml';
const TEMPLATE_DOCUMENT_FILE = 'template.docx';

function validateTemplateId(id: string): string {
  const result = templateIdSchema.safeParse(id);
  if (!result.success) {
    throw new InvalidIdentifierError('Template', id, { details: result.error.issues });
  }
  return result.data;
}

export interface TemplateRepository {
  list(): Promise<TemplateSummary[]>;
  load(id: string): Promise<TemplateSchema>;
  create(input: CreateTemplateInput): Promise<TemplateSchema>;
  saveSchema(id: string, schema: TemplateSchema): Promise<void>;
  duplicate(id: string, newId?: string): Promise<TemplateSchema>;
  delete(id: string): Promise<void>;
  getDocumentPath(id: string): Promise<string>;
}

export function parseTemplateConfig(raw: unknown, templateId: string): TemplateSchema {
  if (
    typeof raw === 'object' &&
    raw !== null &&
    'schema_version' in raw &&
    (raw as { schema_version?: unknown }).schema_version !== TEMPLATE_SCHEMA_VERSION
  ) {
    throw new UnsupportedSchemaVersionError(
      'template.yaml',
      (raw as { schema_version?: unknown }).schema_version,
      TEMPLATE_SCHEMA_VERSION
    );
  }
  const result = templateSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidTemplateSchemaError(templateId, result.error.issues);
  }
  return result.data;
}

export class FileTemplateRepository implements TemplateRepository {
  readonly templatesDir: string;

  constructor(templatesDir: string) {
    this.templatesDir = templatesDir;
  }

  private templateDir(id: string): string {
    return path.join(this.templatesDir, validateTemplateId(id));
  }

  private configFile(id: string): string {
    return path.join(this.templateDir(id), TEMPLATE_CONFIG_FILE);
  }

  async list(): Promise<TemplateSummary[]> {
    const directories = await listSubdirectories(this.templatesDir);
    const summaries: TemplateSummary[] = [];
    for (const id of directories) {
      try {
        const template = await this.load(id);
        const documentPath = path.resolve(this.templateDir(id), template.document.file);
        summaries.push({
          id: template.id,
          name: template.name,
          description: template.description,
          hasDocument: await pathExists(documentPath)
        });
      } catch (error) {
        // A broken template directory must not hide the rest of the list.
        if (
          error instanceof InvalidTemplateSchemaError ||
          error instanceof UnsupportedSchemaVersionError ||
          error instanceof ValidationError
        ) {
          summaries.push({
            id,
            name: id,
            description: `Unreadable template configuration: ${error.code}`,
            hasDocument: await pathExists(path.join(this.templateDir(id), TEMPLATE_DOCUMENT_FILE))
          });
          continue;
        }
        if (error instanceof TemplateNotFoundError) {
          continue;
        }
        if (error instanceof InvalidIdentifierError) {
          continue;
        }
        throw error;
      }
    }
    return summaries;
  }

  async load(id: string): Promise<TemplateSchema> {
    validateTemplateId(id);
    const file = this.configFile(id);
    if (!(await pathExists(file))) {
      throw new TemplateNotFoundError(id);
    }
    let raw: unknown;
    try {
      raw = await readYamlFile(file);
    } catch (error) {
      throw new InvalidTemplateSchemaError(id, error instanceof Error ? error.message : error);
    }
    const template = parseTemplateConfig(raw, id);
    if (template.id !== id) {
      throw new ValidationError('Template id does not match its directory.', {
        directoryId: id,
        schemaId: template.id
      });
    }
    const templateDir = this.templateDir(id);
    const documentPath = path.resolve(templateDir, template.document.file);
    if (path.isAbsolute(template.document.file) || !isPathInside(templateDir, documentPath)) {
      throw new ValidationError('Template document path must stay inside the template directory.', {
        templateId: id
      });
    }
    return template;
  }

  async create(input: CreateTemplateInput): Promise<TemplateSchema> {
    const id = validateTemplateId(input.id ?? slugifyId(input.name));
    const dir = this.templateDir(id);
    if (await pathExists(dir)) {
      throw new AppError('template_already_exists', `Template "${id}" already exists.`);
    }
    await fs.mkdir(dir, { recursive: true });
    await copyFileWithCollisionAvoidance(input.documentPath, dir, TEMPLATE_DOCUMENT_FILE);
    const schema: TemplateSchema = {
      schema_version: TEMPLATE_SCHEMA_VERSION,
      id,
      name: input.name,
      ...(input.description === undefined ? {} : { description: input.description }),
      document: { file: TEMPLATE_DOCUMENT_FILE },
      fields: {},
      bindings: {}
    };
    await this.saveSchema(id, schema);
    return schema;
  }

  async saveSchema(id: string, schema: TemplateSchema): Promise<void> {
    validateTemplateId(id);
    const result = templateSchema.safeParse(schema);
    if (!result.success) {
      throw new InvalidTemplateSchemaError(id, result.error.issues);
    }
    if (result.data.id !== id) {
      throw new ValidationError('Template id does not match its directory.', {
        directoryId: id,
        schemaId: result.data.id
      });
    }
    const templateDir = this.templateDir(id);
    const documentPath = path.resolve(templateDir, result.data.document.file);
    if (path.isAbsolute(result.data.document.file) || !isPathInside(templateDir, documentPath)) {
      throw new ValidationError('Template document path must stay inside the template directory.', {
        templateId: id
      });
    }
    if (!(await pathExists(templateDir))) {
      throw new TemplateNotFoundError(id);
    }
    await writeYamlFileAtomic(this.configFile(id), result.data);
  }

  async duplicate(id: string, newId?: string): Promise<TemplateSchema> {
    const sourceId = validateTemplateId(id);
    const source = await this.load(sourceId);
    const targetId = validateTemplateId(newId ?? `${source.id}-${randomSuffix()}`);
    const sourceDir = this.templateDir(sourceId);
    const targetDir = this.templateDir(targetId);
    if (await pathExists(targetDir)) {
      throw new AppError('template_already_exists', `Template "${targetId}" already exists.`);
    }
    await fs.cp(sourceDir, targetDir, { recursive: true });
    const copy: TemplateSchema = {
      ...source,
      id: targetId,
      name: `${source.name} (copy)`
    };
    await writeYamlFileAtomic(this.configFile(targetId), copy);
    return copy;
  }

  async delete(id: string): Promise<void> {
    validateTemplateId(id);
    const dir = this.templateDir(id);
    if (!(await pathExists(dir))) {
      throw new TemplateNotFoundError(id);
    }
    await removePath(dir);
  }

  async getDocumentPath(id: string): Promise<string> {
    validateTemplateId(id);
    const template = await this.load(id);
    const templateDir = this.templateDir(id);
    const documentPath = path.resolve(templateDir, template.document.file);
    if (path.isAbsolute(template.document.file) || !isPathInside(templateDir, documentPath)) {
      throw new ValidationError('Template document path must stay inside the template directory.', {
        templateId: id
      });
    }
    if (!(await pathExists(documentPath))) {
      throw new AppError(
        'template_document_missing',
        `The document file for template "${id}" is missing.`
      );
    }
    const [realTemplateDir, realDocumentPath] = await Promise.all([
      fs.realpath(templateDir),
      fs.realpath(documentPath)
    ]);
    if (!isPathInside(realTemplateDir, realDocumentPath)) {
      throw new ValidationError(
        'Template document symlinks must stay inside the template directory.',
        {
          templateId: id
        }
      );
    }
    return documentPath;
  }
}
