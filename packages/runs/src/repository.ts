import fs from 'node:fs/promises';
import path from 'node:path';
import {
  atomicWriteFile,
  copyFileWithCollisionAvoidance,
  generateUlid,
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
  RUN_SCHEMA_VERSION,
  type RunArtifacts,
  type RunMetadata,
  type RunSummary,
  runMetadataSchema
} from '@fillforge/schema';

const METADATA_FILE = 'metadata.json';
const PROMPT_FILE = 'prompt.md';
const EXTRACTION_FILE = 'extraction.json';
const REVIEW_FILE = 'review.json';
const NORMALIZED_FILE = 'normalized.json';
const INPUT_DIR = 'input';
const OUTPUT_DIR = 'output';
const LATEST_OUTPUT = 'result.docx';

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

export interface RunRepository {
  create(input: CreateRunInput): Promise<RunMetadata>;
  load(id: string): Promise<RunMetadata>;
  list(): Promise<RunSummary[]>;
  runDir(id: string): string;
  savePrompt(id: string, prompt: string, expectedJson: string): Promise<void>;
  readPrompt(id: string): Promise<string | null>;
  saveExtraction(id: string, extraction: ExtractionResult): Promise<void>;
  readExtraction(id: string): Promise<ExtractionResult | null>;
  saveReview(id: string, review: ReviewedRecord): Promise<void>;
  readReview(id: string): Promise<ReviewedRecord | null>;
  saveNormalized(id: string, values: Record<string, unknown>): Promise<void>;
  readNormalized(id: string): Promise<NormalizedRecord | null>;
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
      const storedPath = await copyFileWithCollisionAvoidance(
        attachment.path,
        path.join(this.runDir(id), INPUT_DIR),
        attachment.originalFilename
      );
      attachments.push({
        filename: path.basename(storedPath),
        original_filename: attachment.originalFilename,
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
    const raw = await readJsonFile(file);
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
    return runMetadataSchema.parse(raw);
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
    const content = `${prompt}\n---\n\nExpected JSON structure:\n\n${expectedJson}\n`;
    await writeTextFileAtomic(this.filePath(id, PROMPT_FILE), content);
  }

  async readPrompt(id: string): Promise<string | null> {
    return this.readTextOrNull(PROMPT_FILE, id);
  }

  async saveExtraction(id: string, extraction: ExtractionResult): Promise<void> {
    await writeJsonFileAtomic(this.filePath(id, EXTRACTION_FILE), extraction);
  }

  async readExtraction(id: string): Promise<ExtractionResult | null> {
    return this.readJsonOrNull<ExtractionResult>(EXTRACTION_FILE, id);
  }

  async saveReview(id: string, review: ReviewedRecord): Promise<void> {
    await writeJsonFileAtomic(this.filePath(id, REVIEW_FILE), review);
  }

  async readReview(id: string): Promise<ReviewedRecord | null> {
    return this.readJsonOrNull<ReviewedRecord>(REVIEW_FILE, id);
  }

  async saveNormalized(id: string, values: Record<string, unknown>): Promise<void> {
    const record: NormalizedRecord = {
      schema_version: RUN_SCHEMA_VERSION,
      values
    };
    await writeJsonFileAtomic(this.filePath(id, NORMALIZED_FILE), record);
  }

  async readNormalized(id: string): Promise<NormalizedRecord | null> {
    return this.readJsonOrNull<NormalizedRecord>(NORMALIZED_FILE, id);
  }

  /**
   * Output policy: every render writes a new versioned file
   * (result-001.docx, result-002.docx, ...) retaining previous outputs, and
   * `result.docx` always mirrors the newest version.
   */
  async saveOutput(id: string, document: Uint8Array): Promise<RenderedArtifact> {
    const outputDir = path.join(this.runDir(id), OUTPUT_DIR);
    await fs.mkdir(outputDir, { recursive: true });
    const entries = await fs.readdir(outputDir);
    const versions = entries
      .map((name) => /^result-(\d{3})\.docx$/.exec(name))
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
      return entries.filter((name) => name.endsWith('.docx')).sort();
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
    const storedPath = await copyFileWithCollisionAvoidance(
      sourcePath,
      path.join(this.runDir(id), INPUT_DIR),
      originalFilename
    );
    const attachment: AttachmentMetadata = {
      filename: path.basename(storedPath),
      original_filename: originalFilename,
      media_type: mediaTypeForFilename(originalFilename)
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

  private async readJsonOrNull<T>(filename: string, id: string): Promise<T | null> {
    const file = this.filePath(id, filename);
    if (!(await pathExists(file))) {
      return null;
    }
    return readJsonFile(file) as Promise<T>;
  }
}
