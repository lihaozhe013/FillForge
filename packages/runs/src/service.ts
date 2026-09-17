import path from 'node:path';
import { ArtifactImmutableError, ValidationError } from '@fillforge/core';
import type { DocumentRenderer } from '@fillforge/docx';
import {
  buildExtractionPrompt,
  type ExtractionIssue,
  normalizeValues,
  parseExtractionResult,
  validateBusinessValues,
  validateExtractionResult,
  validateReviewedValues
} from '@fillforge/extraction';
import {
  type AttachmentMetadata,
  type ExtractionResult,
  PROMPT_VERSION,
  type ReviewedRecord,
  type RunMetadata,
  type RunSummary,
  type TemplateSchema
} from '@fillforge/schema';
import { resolveBindings, type TemplateService } from '@fillforge/templates';
import {
  parsePromptArtifact,
  type RenderedArtifact,
  type RunAttachmentInput,
  type RunRepository
} from './repository.ts';
import { buildReviewRecord, getEffectiveValues } from './review.ts';

export interface RunOutput {
  filename: string;
  path: string;
}

export interface RunDetails {
  metadata: RunMetadata;
  prompt: string | null;
  expectedJson: string | null;
  extraction: ExtractionResult | null;
  review: ReviewedRecord | null;
  normalized: Record<string, unknown> | null;
  outputs: RunOutput[];
}

export class RunService {
  private readonly runRepository: RunRepository;

  private readonly templateService: TemplateService;

  private readonly renderer: DocumentRenderer;

  private promptVersion: string;

  constructor(
    runRepository: RunRepository,
    templateService: TemplateService,
    renderer: DocumentRenderer,
    promptVersion: string = PROMPT_VERSION
  ) {
    this.runRepository = runRepository;
    this.templateService = templateService;
    this.renderer = renderer;
    this.promptVersion = promptVersion;
  }

  async createRun(input: {
    templateId: string;
    attachments?: RunAttachmentInput[];
  }): Promise<RunMetadata> {
    const template = await this.templateService.loadTemplate(input.templateId);
    return this.runRepository.create({
      templateId: template.id,
      templateSchemaVersion: template.schema_version,
      promptVersion: this.promptVersion,
      attachments: input.attachments
    });
  }

  async getRun(runId: string): Promise<RunDetails> {
    const metadata = await this.runRepository.load(runId);
    const [promptArtifact, extraction, review, normalized, outputs] = await Promise.all([
      this.readPromptArtifact(runId),
      this.runRepository.readExtraction(runId),
      this.runRepository.readReview(runId),
      this.runRepository.readNormalized(runId),
      this.runRepository.listOutputs(runId)
    ]);
    const outputDir = path.join(this.runRepository.runDir(runId), 'output');
    return {
      metadata,
      prompt: promptArtifact?.prompt ?? null,
      expectedJson: promptArtifact?.expectedJson ?? null,
      extraction,
      review,
      normalized: normalized?.values ?? null,
      outputs: outputs.map((filename) => ({
        filename,
        path: path.join(outputDir, filename)
      }))
    };
  }

  listRuns(): Promise<RunSummary[]> {
    return this.runRepository.list();
  }

  setPromptVersion(promptVersion: string): void {
    this.promptVersion = promptVersion;
  }

  addAttachment(
    runId: string,
    sourcePath: string,
    originalFilename: string
  ): Promise<AttachmentMetadata> {
    return this.runRepository.addAttachment(runId, sourcePath, originalFilename);
  }

  async generatePrompt(runId: string): Promise<string> {
    const existing = await this.readPromptArtifact(runId);
    if (existing) {
      return existing.prompt;
    }
    const run = await this.runRepository.load(runId);
    const template = await this.loadRunTemplate(runId);
    const generated = buildExtractionPrompt(template, run.prompt_version);
    await this.runRepository.savePrompt(runId, generated.prompt, generated.expectedJson);
    return generated.prompt;
  }

  async getPrompt(runId: string): Promise<string | null> {
    return (await this.readPromptArtifact(runId))?.prompt ?? null;
  }

  async importExtraction(
    runId: string,
    raw: string
  ): Promise<{ result: ExtractionResult; issues: ExtractionIssue[] }> {
    if (await this.runRepository.readExtraction(runId)) {
      throw new ArtifactImmutableError('extraction.json');
    }
    const template = await this.loadRunTemplate(runId);
    const result = parseExtractionResult(raw);
    const issues = validateExtractionResult(result, template);
    await this.runRepository.saveExtraction(runId, result);
    return { result, issues };
  }

  /**
   * Persist the human review. The original extraction.json is never touched;
   * corrections live only in review.json.
   */
  async saveReview(runId: string, finalValues: Record<string, unknown>): Promise<ReviewedRecord> {
    return (await this.saveReviewWithIssues(runId, finalValues)).review;
  }

  async saveReviewWithIssues(
    runId: string,
    finalValues: Record<string, unknown>
  ): Promise<{ review: ReviewedRecord; issues: ExtractionIssue[] }> {
    const extraction = await this.requireExtraction(runId);
    const template = await this.loadRunTemplate(runId);
    const record = buildReviewRecord(extraction, finalValues, Object.keys(template.fields));
    const reviewedValues = Object.fromEntries(
      Object.entries(record.fields).map(([key, field]) => [key, field.final_value])
    );
    const issues = validateReviewedValues(reviewedValues, template);
    await this.runRepository.saveReview(runId, record);
    await this.runRepository.clearNormalized?.(runId);
    return { review: record, issues };
  }

  async buildNormalized(runId: string): Promise<Record<string, unknown>> {
    const extraction = await this.requireExtraction(runId);
    const template = await this.loadRunTemplate(runId);
    const review = await this.runRepository.readReview(runId);
    const effective = getEffectiveValues(extraction, review);
    const values = normalizeValues(effective, template.fields);
    await this.runRepository.saveNormalized(runId, values);
    return values;
  }

  async renderRun(runId: string): Promise<RenderedArtifact> {
    const template = await this.loadRunTemplate(runId);
    const values = await this.buildNormalized(runId);

    this.assertRenderable(template, values);

    const document = await this.templateService.readTemplateDocument(template.id);
    const resolved = resolveBindings(values, template.bindings ?? {});
    const rendered = await this.renderer.render({ document, values: resolved });
    return this.runRepository.saveOutput(runId, rendered);
  }

  private assertRenderable(template: TemplateSchema, values: Record<string, unknown>): void {
    const issues = validateBusinessValues(values, template);
    if (issues.length > 0) {
      throw new ValidationError(
        'The run is not ready to render; review the flagged fields first.',
        issues
      );
    }
  }

  private async loadRunTemplate(runId: string): Promise<TemplateSchema> {
    const run = await this.runRepository.load(runId);
    return this.templateService.loadTemplate(run.template_id);
  }

  private async requireExtraction(runId: string): Promise<ExtractionResult> {
    const extraction = await this.runRepository.readExtraction(runId);
    if (!extraction) {
      throw new ValidationError('No extraction result has been imported for this run yet.', {
        runId
      });
    }
    return extraction;
  }

  private async readPromptArtifact(runId: string) {
    if (this.runRepository.readPromptArtifact) {
      return this.runRepository.readPromptArtifact(runId);
    }
    const raw = await this.runRepository.readPrompt(runId);
    return raw === null ? null : parsePromptArtifact(raw);
  }
}
