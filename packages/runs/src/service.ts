import { ValidationError } from "@docufill/core";
import type { DocumentRenderer } from "@docufill/docx";
import {
  buildExtractionPrompt,
  type ExtractionIssue,
  normalizeValues,
  parseExtractionResult,
  validateExtractionResult,
  valueFailsFieldValidation,
} from "@docufill/extraction";
import {
  type ExtractionResult,
  PROMPT_VERSION,
  type ReviewedRecord,
  type RunMetadata,
  type RunSummary,
  type TemplateSchema,
} from "@docufill/schema";
import { resolveBindings, type TemplateService } from "@docufill/templates";
import type { RenderedArtifact, RunAttachmentInput, RunRepository } from "./repository.ts";
import { buildReviewRecord, getEffectiveValues } from "./review.ts";

export interface RunDetails {
  metadata: RunMetadata;
  prompt: string | null;
  extraction: ExtractionResult | null;
  review: ReviewedRecord | null;
  normalized: Record<string, unknown> | null;
  outputs: string[];
}

export class RunService {
  private readonly runRepository: RunRepository;

  private readonly templateService: TemplateService;

  private readonly renderer: DocumentRenderer;

  constructor(
    runRepository: RunRepository,
    templateService: TemplateService,
    renderer: DocumentRenderer,
  ) {
    this.runRepository = runRepository;
    this.templateService = templateService;
    this.renderer = renderer;
  }

  async createRun(input: {
    templateId: string;
    attachments?: RunAttachmentInput[];
  }): Promise<RunMetadata> {
    const template = await this.templateService.loadTemplate(input.templateId);
    return this.runRepository.create({
      templateId: template.id,
      templateSchemaVersion: template.schema_version,
      promptVersion: PROMPT_VERSION,
      attachments: input.attachments,
    });
  }

  async getRun(runId: string): Promise<RunDetails> {
    const metadata = await this.runRepository.load(runId);
    const [prompt, extraction, review, normalized, outputs] = await Promise.all([
      this.runRepository.readPrompt(runId),
      this.runRepository.readExtraction(runId),
      this.runRepository.readReview(runId),
      this.runRepository.readNormalized(runId),
      this.runRepository.listOutputs(runId),
    ]);
    return {
      metadata,
      prompt,
      extraction,
      review,
      normalized: normalized?.values ?? null,
      outputs,
    };
  }

  listRuns(): Promise<RunSummary[]> {
    return this.runRepository.list();
  }

  async generatePrompt(runId: string): Promise<string> {
    const template = await this.loadRunTemplate(runId);
    const generated = buildExtractionPrompt(template);
    await this.runRepository.savePrompt(runId, generated.prompt, generated.expectedJson);
    return generated.prompt;
  }

  async getPrompt(runId: string): Promise<string | null> {
    return this.runRepository.readPrompt(runId);
  }

  async importExtraction(
    runId: string,
    raw: string,
  ): Promise<{ result: ExtractionResult; issues: ExtractionIssue[] }> {
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
    const extraction = await this.requireExtraction(runId);
    const template = await this.loadRunTemplate(runId);
    const record = buildReviewRecord(extraction, finalValues);
    const issues: ExtractionIssue[] = [];
    for (const [key, field] of Object.entries(template.fields)) {
      if (Object.hasOwn(finalValues, key) && valueFailsFieldValidation(field, finalValues[key])) {
        issues.push({
          field: key,
          code: "rule_violation",
          message: `Field "${key}" violates its validation rules.`,
        });
      }
    }
    await this.runRepository.saveReview(runId, record);
    return record;
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
    const values =
      (await this.runRepository.readNormalized(runId))?.values ??
      (await this.buildNormalized(runId));

    this.assertRenderable(template, values);

    const document = await this.templateService.readTemplateDocument(template.id);
    const resolved = resolveBindings(values, template.bindings ?? {});
    const rendered = await this.renderer.render({ document, values: resolved });
    return this.runRepository.saveOutput(runId, rendered);
  }

  private assertRenderable(template: TemplateSchema, values: Record<string, unknown>): void {
    const issues: ExtractionIssue[] = [];
    for (const [key, field] of Object.entries(template.fields)) {
      if (!field.required) {
        continue;
      }
      if (!Object.hasOwn(values, key)) {
        issues.push({
          field: key,
          code: "required_value_missing",
          message: `Required field "${key}" (${field.label}) has no reviewed value.`,
        });
        continue;
      }
      if (valueFailsFieldValidation(field, values[key])) {
        issues.push({
          field: key,
          code: "rule_violation",
          message: `Field "${key}" (${field.label}) violates its validation rules.`,
        });
      }
    }
    if (issues.length > 0) {
      throw new ValidationError(
        "The run is not ready to render; review the flagged fields first.",
        issues,
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
      throw new ValidationError("No extraction result has been imported for this run yet.", {
        runId,
      });
    }
    return extraction;
  }
}
