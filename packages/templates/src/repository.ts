import fs from "node:fs/promises";
import path from "node:path";
import {
  AppError,
  copyFileWithCollisionAvoidance,
  InvalidTemplateSchemaError,
  listSubdirectories,
  pathExists,
  randomSuffix,
  readYamlFile,
  removePath,
  slugifyId,
  TemplateNotFoundError,
  UnsupportedSchemaVersionError,
  writeYamlFileAtomic,
} from "@docufill/core";
import {
  type CreateTemplateInput,
  TEMPLATE_SCHEMA_VERSION,
  type TemplateSchema,
  type TemplateSummary,
  templateSchema,
} from "@docufill/schema";

const TEMPLATE_CONFIG_FILE = "template.yaml";
const TEMPLATE_DOCUMENT_FILE = "template.docx";

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
    typeof raw === "object" &&
    raw !== null &&
    "schema_version" in raw &&
    (raw as { schema_version?: unknown }).schema_version !== TEMPLATE_SCHEMA_VERSION
  ) {
    throw new UnsupportedSchemaVersionError(
      "template.yaml",
      (raw as { schema_version?: unknown }).schema_version,
      TEMPLATE_SCHEMA_VERSION,
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
    return path.join(this.templatesDir, id);
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
        summaries.push({
          id: template.id,
          name: template.name,
          description: template.description,
          hasDocument: await pathExists(this.documentPath(id)),
        });
      } catch (error) {
        // A broken template directory must not hide the rest of the list.
        if (
          error instanceof InvalidTemplateSchemaError ||
          error instanceof UnsupportedSchemaVersionError
        ) {
          summaries.push({
            id,
            name: id,
            description: `Unreadable template configuration: ${error.code}`,
            hasDocument: await pathExists(this.documentPath(id)),
          });
          continue;
        }
        if (error instanceof TemplateNotFoundError) {
          continue;
        }
        throw error;
      }
    }
    return summaries;
  }

  async load(id: string): Promise<TemplateSchema> {
    const file = this.configFile(id);
    if (!(await pathExists(file))) {
      throw new TemplateNotFoundError(id);
    }
    const raw = await readYamlFile(file);
    return parseTemplateConfig(raw, id);
  }

  async create(input: CreateTemplateInput): Promise<TemplateSchema> {
    const id = input.id ?? slugifyId(input.name);
    const dir = this.templateDir(id);
    if (await pathExists(dir)) {
      throw new AppError("template_already_exists", `Template "${id}" already exists.`);
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
      bindings: {},
    };
    await this.saveSchema(id, schema);
    return schema;
  }

  async saveSchema(id: string, schema: TemplateSchema): Promise<void> {
    const result = templateSchema.safeParse(schema);
    if (!result.success) {
      throw new InvalidTemplateSchemaError(id, result.error.issues);
    }
    await writeYamlFileAtomic(this.configFile(id), schema);
  }

  async duplicate(id: string, newId?: string): Promise<TemplateSchema> {
    const source = await this.load(id);
    const targetId = newId ?? `${source.id}-${randomSuffix()}`;
    const sourceDir = this.templateDir(id);
    const targetDir = this.templateDir(targetId);
    if (await pathExists(targetDir)) {
      throw new AppError("template_already_exists", `Template "${targetId}" already exists.`);
    }
    await fs.cp(sourceDir, targetDir, { recursive: true });
    const copy: TemplateSchema = {
      ...source,
      id: targetId,
      name: `${source.name} (copy)`,
    };
    await writeYamlFileAtomic(this.configFile(targetId), copy);
    return copy;
  }

  async delete(id: string): Promise<void> {
    const dir = this.templateDir(id);
    if (!(await pathExists(dir))) {
      throw new TemplateNotFoundError(id);
    }
    await removePath(dir);
  }

  async getDocumentPath(id: string): Promise<string> {
    const template = await this.load(id);
    const documentPath = path.join(this.templateDir(id), template.document.file);
    if (!(await pathExists(documentPath))) {
      throw new AppError(
        "template_document_missing",
        `The document file for template "${id}" is missing.`,
      );
    }
    return documentPath;
  }

  private documentPath(id: string): string {
    return path.join(this.templateDir(id), TEMPLATE_DOCUMENT_FILE);
  }
}
