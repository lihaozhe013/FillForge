import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ArtifactImmutableError,
  atomicWriteFile,
  copyFileWithCollisionAvoidance,
  generateUlid,
  InvalidIdentifierError,
  InvalidRunArtifactError,
  isValidUlid,
  listSubdirectories,
  pathExists,
  RunNotFoundError,
  readJsonFile,
  readTextFile,
  UnsupportedSchemaVersionError,
  writeJsonFileAtomic,
  writeTextFileAtomic
} from '@fillforge/core';
import {
  type AttachmentMetadata,
  type ExtractionResult,
  type NormalizedRecord,
  type ReviewedRecord,
  extractionResultSchema,
  EXTRACTION_SCHEMA_VERSION,
  persistedExtractionSchema,
  RUN_SCHEMA_VERSION,
  type RunArtifacts,
  type RunMetadata,
  type RunSummary,
  runMetadataSchema,
  normalizedRecordSchema,
  reviewedRecordSchema
} from '@fillforge/schema';

const METADATA_FILE = 'metadata.json';
const PROMPT_FILE = 'prompt.md';
const EXTRACTION_FILE = 'extraction.json';
const REVIEW_FILE = 'review.json';
const NORMALIZED_FILE = 'normalized.json';
const INPUT_DIR = 'input';
const OUTPUT_DIR = 'output';
const LATEST_OUTPUT = 'result.docx';

function safeAttachmentFilename(originalFilename: string, sourcePath: string): string {
  return path.basename(originalFilename) || path.basename(sourcePath) || 'attachment';
}

export interface RunAttachmentInput {
  path: string;
  originalFilename: string;
  mediaType: string;
}

export interface CreateRunInput {
  templateId: string;
  templateSchemaVersion: number;
  promptVersion: string;
  attachments?: RunAttachmentInput[];
}

export interface RenderedArtifact {
  path: string;
  filename: string;
}

export interface PromptArtifact {
  prompt: string;
  expectedJson: string;
}

export interface RunRepository {
  create(input: CreateRunInput): Promise<RunMetadata>;
  load(id: string): Promise<RunMetadata>;
  list(): Promise<RunSummary[]>;
  runDir(id: string): string;
  savePrompt(id: string, prompt: string, expectedJson: string): Promise<void>;
  readPrompt(id: string): Promise<string | null>;
  readPromptArtifact?(id: string): Promise<PromptArtifact | null>;
  saveExtraction(id: string, extraction: ExtractionResult): Promise<void>;
  readExtraction(id: string): Promise<ExtractionResult | null>;
  saveReview(id: string, review: ReviewedRecord): Promise<void>;
  readReview(id: string): Promise<ReviewedRecord | null>;
  saveNormalized(id: string, values: Record<string, unknown>): Promise<void>;
  readNormalized(id: string): Promise<NormalizedRecord | null>;
  clearNormalized?(id: string): Promise<void>;
  saveOutput(id: string, document: Uint8Array): Promise<RenderedArtifact>;
  listOutputs(id: string): Promise<string[]>;
  addAttachment(
    id: string,
    sourcePath: string,
    originalFilename: string
  ): Promise<AttachmentMetadata>;
}

export function mediaTypeForFilename(filename: string): string {
  const extension = path.extname(filename).toLowerCase();
  const known: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown'
  };
  return known[extension] ?? 'application/octet-stream';
}

export class FileRunRepository implements RunRepository {
  readonly runsDir: string;

  constructor(runsDir: string) {
    this.runsDir = runsDir;
  }

  runDir(id: string): string {
    if (!isValidUlid(id)) {
      throw new InvalidIdentifierError('Run', id);
    }
    return path.join(this.runsDir, id);
  }

  private filePath(id: string, filename: string): string {
    return path.join(this.runDir(id), filename);
  }

  async create(input: CreateRunInput): Promise<RunMetadata> {
    const id = generateUlid();
    await fs.mkdir(path.join(this.runDir(id), INPUT_DIR), { recursive: true });
    await fs.mkdir(path.join(this.runDir(id), OUTPUT_DIR), { recursive: true });

    const attachments: AttachmentMetadata[] = [];
    for (const attachment of input.attachments ?? []) {
      const originalFilename = safeAttachmentFilename(attachment.originalFilename, attachment.path);
      const storedPath = await copyFileWithCollisionAvoidance(
        attachment.path,
        path.join(this.runDir(id), INPUT_DIR),
        originalFilename
      );
      attachments.push({
        filename: path.basename(storedPath),
        original_filename: originalFilename,
        media_type: attachment.mediaType
      });
    }

    const metadata: RunMetadata = {
      schema_version: RUN_SCHEMA_VERSION,
      id,
      created_at: new Date().toISOString(),
      template_id: input.templateId,
      template_schema_version: input.templateSchemaVersion,
      prompt_version: input.promptVersion,
      attachments
    };
    await writeJsonFileAtomic(this.filePath(id, METADATA_FILE), metadata);
    return metadata;
  }

  async load(id: string): Promise<RunMetadata> {
    const file = this.filePath(id, METADATA_FILE);
    if (!(await pathExists(file))) {
      throw new RunNotFoundError(id);
    }
    let raw: unknown;
    try {
      raw = await readJsonFile(file);
    } catch (error) {
      throw new InvalidRunArtifactError(
        METADATA_FILE,
        error instanceof Error ? error.message : error
      );
    }
    if (
      typeof raw === 'object' &&
      raw !== null &&
      'schema_version' in raw &&
      (raw as { schema_version?: unknown }).schema_version !== RUN_SCHEMA_VERSION
    ) {
      throw new UnsupportedSchemaVersionError(
        METADATA_FILE,
        (raw as { schema_version?: unknown }).schema_version,
        RUN_SCHEMA_VERSION
      );
    }
    const parsed = runMetadataSchema.safeParse(raw);
    if (!parsed.success) {
      throw new InvalidRunArtifactError(METADATA_FILE, parsed.error.issues);
    }
    if (parsed.data.id !== id) {
      throw new InvalidRunArtifactError(METADATA_FILE, {
        message: 'Run metadata id does not match its directory.',
        directoryId: id,
        metadataId: parsed.data.id
      });
    }
    return parsed.data;
  }

  async list(): Promise<RunSummary[]> {
    const ids = await listSubdirectories(this.runsDir);
    const summaries: RunSummary[] = [];
    for (const id of ids) {
      try {
        const metadata = await this.load(id);
        summaries.push({
          id: metadata.id,
          createdAt: metadata.created_at,
          templateId: metadata.template_id,
          artifacts: await this.describeArtifacts(id)
        });
      } catch {
        // Unreadable run directories are skipped; they stay on disk untouched.
      }
    }
    return summaries.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  private async describeArtifacts(id: string): Promise<RunArtifacts> {
    const exists = (filename: string) => pathExists(this.filePath(id, filename));
    return {
      prompt: await exists(PROMPT_FILE),
      extraction: await exists(EXTRACTION_FILE),
      review: await exists(REVIEW_FILE),
      normalized: await exists(NORMALIZED_FILE),
      output: (await this.listOutputs(id)).length > 0
    };
  }

  async savePrompt(id: string, prompt: string, expectedJson: string): Promise<void> {
    await this.load(id);
    const file = this.filePath(id, PROMPT_FILE);
    if (await pathExists(file)) {
      throw new ArtifactImmutableError(PROMPT_FILE);
    }
    const content = `${prompt}\n---\n\nExpected JSON structure:\n\n${expectedJson}\n`;
    await writeTextFileAtomic(file, content);
  }

  async readPrompt(id: string): Promise<string | null> {
    await this.load(id);
    return this.readTextOrNull(PROMPT_FILE, id);
  }

  async readPromptArtifact(id: string): Promise<PromptArtifact | null> {
    const text = await this.readPrompt(id);
    if (text === null) {
      return null;
    }
    return parsePromptArtifact(text);
  }

  async saveExtraction(id: string, extraction: ExtractionResult): Promise<void> {
    await this.load(id);
    const file = this.filePath(id, EXTRACTION_FILE);
    if (await pathExists(file)) {
      throw new ArtifactImmutableError(EXTRACTION_FILE);
    }
    const result = extractionResultSchema.safeParse(extraction);
    if (!result.success) {
      throw new InvalidRunArtifactError(EXTRACTION_FILE, result.error.issues);
    }
    await writeJsonFileAtomic(this.filePath(id, EXTRACTION_FILE), {
      schema_version: EXTRACTION_SCHEMA_VERSION,
      result: result.data
    });
  }

  async readExtraction(id: string): Promise<ExtractionResult | null> {
    const persisted = await this.readJsonArtifact(EXTRACTION_FILE, id, (raw) => {
      const result = persistedExtractionSchema.safeParse(raw);
      if (!result.success) {
        throw result.error.issues;
      }
      return result.data;
    });
    return persisted?.result ?? null;
  }

  async saveReview(id: string, review: ReviewedRecord): Promise<void> {
    await this.load(id);
    const result = reviewedRecordSchema.safeParse(review);
    if (!result.success) {
      throw new InvalidRunArtifactError(REVIEW_FILE, result.error.issues);
    }
    await writeJsonFileAtomic(this.filePath(id, REVIEW_FILE), result.data);
  }

  async readReview(id: string): Promise<ReviewedRecord | null> {
    return this.readJsonArtifact(REVIEW_FILE, id, (raw) => {
      const result = reviewedRecordSchema.safeParse(raw);
      if (!result.success) {
        throw result.error.issues;
      }
      return result.data;
    });
  }

  async saveNormalized(id: string, values: Record<string, unknown>): Promise<void> {
    const record: NormalizedRecord = {
      schema_version: RUN_SCHEMA_VERSION,
      values
    };
    await this.load(id);
    const result = normalizedRecordSchema.safeParse(record);
    if (!result.success) {
      throw new InvalidRunArtifactError(NORMALIZED_FILE, result.error.issues);
    }
    await writeJsonFileAtomic(this.filePath(id, NORMALIZED_FILE), result.data);
  }

  async readNormalized(id: string): Promise<NormalizedRecord | null> {
    return this.readJsonArtifact(NORMALIZED_FILE, id, (raw) => {
      const result = normalizedRecordSchema.safeParse(raw);
      if (!result.success) {
        throw result.error.issues;
      }
      return result.data;
    });
  }

  async clearNormalized(id: string): Promise<void> {
    await this.load(id);
    await fs.rm(this.filePath(id, NORMALIZED_FILE), { force: true });
  }

  /**
   * Output policy: every render writes a new versioned file
   * (result-001.docx, result-002.docx, ...) retaining previous outputs, and
   * `result.docx` always mirrors the newest version.
   */
  async saveOutput(id: string, document: Uint8Array): Promise<RenderedArtifact> {
    await this.load(id);
    const outputDir = path.join(this.runDir(id), OUTPUT_DIR);
    await fs.mkdir(outputDir, { recursive: true });
    const entries = await fs.readdir(outputDir);
    const versions = entries
      .map((name) => /^result-(\d+)\.docx$/.exec(name))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]))
      .sort((a, b) => a - b);
    const nextVersion = (versions.at(-1) ?? 0) + 1;
    const filename = `result-${String(nextVersion).padStart(3, '0')}.docx`;
    const target = path.join(outputDir, filename);
    await atomicWriteFile(target, document);
    await atomicWriteFile(path.join(outputDir, LATEST_OUTPUT), document);
    return { path: target, filename };
  }

  async listOutputs(id: string): Promise<string[]> {
    const outputDir = path.join(this.runDir(id), OUTPUT_DIR);
    try {
      const entries = await fs.readdir(outputDir);
      return entries
        .filter((name) => name === LATEST_OUTPUT || /^result-\d+\.docx$/.test(name))
        .sort();
    } catch {
      return [];
    }
  }

  async addAttachment(
    id: string,
    sourcePath: string,
    originalFilename: string
  ): Promise<AttachmentMetadata> {
    await this.load(id);
    const safeOriginalFilename = safeAttachmentFilename(originalFilename, sourcePath);
    const storedPath = await copyFileWithCollisionAvoidance(
      sourcePath,
      path.join(this.runDir(id), INPUT_DIR),
      safeOriginalFilename
    );
    const attachment: AttachmentMetadata = {
      filename: path.basename(storedPath),
      original_filename: safeOriginalFilename,
      media_type: mediaTypeForFilename(safeOriginalFilename)
    };
    const metadata = await this.load(id);
    const updated: RunMetadata = {
      ...metadata,
      attachments: [...metadata.attachments, attachment]
    };
    await writeJsonFileAtomic(this.filePath(id, METADATA_FILE), updated);
    return attachment;
  }

  private async readTextOrNull(filename: string, id: string): Promise<string | null> {
    const file = this.filePath(id, filename);
    if (!(await pathExists(file))) {
      return null;
    }
    return readTextFile(file);
  }

  private async readJsonArtifact<T>(
    filename: string,
    id: string,
    parse: (raw: unknown) => T
  ): Promise<T | null> {
    await this.load(id);
    const file = this.filePath(id, filename);
    if (!(await pathExists(file))) {
      return null;
    }
    let raw: unknown;
    try {
      raw = await readJsonFile(file);
    } catch (error) {
      throw new InvalidRunArtifactError(filename, error instanceof Error ? error.message : error);
    }
    try {
      return parse(raw);
    } catch (error) {
      throw new InvalidRunArtifactError(filename, error);
    }
  }
}

export function parsePromptArtifact(text: string): PromptArtifact {
  const marker = '\n---\n\nExpected JSON structure:\n\n';
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) {
    return { prompt: text, expectedJson: '' };
  }
  return {
    prompt: text.slice(0, markerIndex),
    expectedJson: text.slice(markerIndex + marker.length).trim()
  };
}
