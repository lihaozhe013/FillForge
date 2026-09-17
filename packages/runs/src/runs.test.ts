import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ArtifactImmutableError, InvalidRunArtifactError, ValidationError } from '@fillforge/core';
import { createDocxtemplaterRenderer } from '@fillforge/docx';
import type { ExtractionResult, ReviewedRecord } from '@fillforge/schema';
import { TemplateService } from '@fillforge/templates';
import PizZip from 'pizzip';
import { describe, expect, it } from 'vitest';
import { FileRunRepository } from './repository.ts';
import { decideReviewDecision, getEffectiveValues } from './review.ts';
import { RunService } from './service.ts';

const FIXTURES = path.resolve(import.meta.dirname, '../../../tests/fixtures');

async function createServices() {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fillforge-runs-'));
  const dataDir = path.join(home, '.local', 'fillforge');
  const renderer = createDocxtemplaterRenderer();
  const templateService = TemplateService.createDefault(path.join(dataDir, 'templates'), renderer);
  const runRepository = new FileRunRepository(path.join(dataDir, 'runs'));
  const runService = new RunService(runRepository, templateService, renderer);
  return { runService, runRepository, templateService };
}

async function setupInvoiceTemplate(templateService: TemplateService): Promise<string> {
  await templateService.importTemplate({
    id: 'invoice-cn',
    name: '中国发票',
    documentPath: path.join(FIXTURES, 'templates/invoice/invoice-template.docx')
  });
  await templateService.mergeFields('invoice-cn', {
    invoice_number: {
      label: '发票号码',
      type: 'string',
      required: true,
      normalization: { trim: true, remove_spaces: true },
      validation: { regex: '^[0-9A-Za-z-]+$' }
    },
    invoice_date: {
      label: '开票日期',
      type: 'date',
      required: true,
      output: { format: 'YYYY-MM-DD' }
    },
    seller_name: { label: '销售方名称', type: 'string', required: true },
    total_amount: { label: '价税合计', type: 'number', required: true }
  });
  await templateService.mergeBindings('invoice-cn', {
    invoice_number: { source: 'invoice_number' },
    invoice_date: { source: 'invoice_date' },
    seller_name: { source: 'seller_name' },
    total_amount: { source: 'total_amount' }
  });
  return 'invoice-cn';
}

async function outputText(docxPath: string): Promise<string> {
  const zip = new PizZip(await fs.readFile(docxPath));
  return (zip.file('word/document.xml')?.asText() ?? '').replace(/<[^>]+>/g, '');
}

const validExtraction = `{
  "invoice_number": { "value": " 1234 5678 ", "status": "found", "evidence": "发票号码：12345678" },
  "invoice_date": { "value": "2026年09月16日", "status": "found", "evidence": "开票日期：2026年09月16日" },
  "seller_name": { "value": "示例科技有限公司", "status": "found", "evidence": "销售方" },
  "total_amount": { "value": 1234.5, "status": "found", "evidence": "价税合计" }
}`;

describe('RunService end to end', () => {
  it('runs the full template → prompt → extraction → review → render flow', async () => {
    const { runService, runRepository, templateService } = await createServices();
    await setupInvoiceTemplate(templateService);

    const attachmentDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fillforge-src-'));
    const attachmentSource = path.join(attachmentDir, 'invoice.jpg');
    await fs.writeFile(attachmentSource, 'fake-image-bytes');

    const run = await runService.createRun({
      templateId: 'invoice-cn',
      attachments: [
        {
          path: attachmentSource,
          originalFilename: 'invoice.jpg',
          mediaType: 'image/jpeg'
        }
      ]
    });
    expect(run.template_id).toBe('invoice-cn');
    expect(run.attachments).toHaveLength(1);

    const prompt = await runService.generatePrompt(run.id);
    expect(prompt).toContain('invoice_number');
    expect(prompt).toContain('Meaning: 发票号码');
    const promptArtifact = await runRepository.readPromptArtifact?.(run.id);
    expect(promptArtifact?.expectedJson).toContain('invoice_number');

    const { result, issues } = await runService.importExtraction(run.id, validExtraction);
    // The raw model value " 1234 5678 " fails the regex before normalization;
    // import issues are reported for review, not fatal.
    expect(issues.map((issue) => `${issue.field}:${issue.code}`)).toEqual([
      'invoice_number:rule_violation'
    ]);
    expect(result.invoice_number?.status).toBe('found');

    const review = await runService.saveReview(run.id, {
      invoice_number: '12345679'
    });
    expect(review.fields.invoice_number).toMatchObject({
      model_value: ' 1234 5678 ',
      final_value: '12345679',
      decision: 'corrected'
    });
    expect(review.fields.invoice_date?.decision).toBe('accepted');

    // The original AI output stays untouched on disk.
    const extractionOnDisk = JSON.parse(
      await fs.readFile(path.join(runRepository.runDir(run.id), 'extraction.json'), 'utf8')
    ) as { result: { invoice_number: { value: string } } };
    expect(extractionOnDisk.result.invoice_number.value).toBe(' 1234 5678 ');

    const normalized = await runService.buildNormalized(run.id);
    expect(normalized).toEqual({
      invoice_number: '12345679',
      invoice_date: '2026-09-16',
      seller_name: '示例科技有限公司',
      total_amount: 1234.5
    });

    const artifact = await runService.renderRun(run.id);
    expect(artifact.filename).toBe('result-001.docx');
    expect(await outputText(artifact.path)).toContain('发票号码：12345679');
    expect(await outputText(artifact.path)).toContain('开票日期：2026-09-16');

    const details = await runService.getRun(run.id);
    expect(details.outputs.map((output) => output.filename)).toEqual([
      'result-001.docx',
      'result.docx'
    ]);
    expect(details.review?.fields.seller_name?.decision).toBe('accepted');

    const runs = await runService.listRuns();
    expect(runs.map((summary) => summary.id)).toContain(run.id);
    expect(runs[0]?.artifacts.output).toBe(true);
  });

  it('retains previous outputs and mirrors the newest as result.docx', async () => {
    const { runService, templateService } = await createServices();
    await setupInvoiceTemplate(templateService);
    const run = await runService.createRun({ templateId: 'invoice-cn' });
    await runService.importExtraction(run.id, validExtraction);
    await runService.saveReview(run.id, {});

    const first = await runService.renderRun(run.id);
    const second = await runService.renderRun(run.id);
    expect(first.filename).toBe('result-001.docx');
    expect(second.filename).toBe('result-002.docx');
    const details = await runService.getRun(run.id);
    expect(details.outputs.map((output) => output.filename)).toEqual([
      'result-001.docx',
      'result-002.docx',
      'result.docx'
    ]);
  });

  it('keeps prompt and extraction evidence immutable', async () => {
    const { runService, runRepository, templateService } = await createServices();
    await setupInvoiceTemplate(templateService);
    const run = await runService.createRun({ templateId: 'invoice-cn' });

    const firstPrompt = await runService.generatePrompt(run.id);
    expect(await runService.generatePrompt(run.id)).toBe(firstPrompt);
    const promptFile = path.join(runRepository.runDir(run.id), 'prompt.md');
    const promptOnDisk = await fs.readFile(promptFile, 'utf8');
    expect((await runRepository.readPromptArtifact?.(run.id))?.expectedJson).toContain(
      'invoice_date'
    );

    await runService.importExtraction(run.id, validExtraction);
    await expect(runService.importExtraction(run.id, validExtraction)).rejects.toBeInstanceOf(
      ArtifactImmutableError
    );
    expect(await fs.readFile(promptFile, 'utf8')).toBe(promptOnDisk);
  });

  it('invalidates normalized values when review changes', async () => {
    const { runService, runRepository, templateService } = await createServices();
    await setupInvoiceTemplate(templateService);
    const run = await runService.createRun({ templateId: 'invoice-cn' });
    await runService.importExtraction(run.id, validExtraction);
    await runService.saveReview(run.id, {});
    await runService.buildNormalized(run.id);
    await expect(
      fs.access(path.join(runRepository.runDir(run.id), 'normalized.json'))
    ).resolves.toBeUndefined();

    const first = await runService.renderRun(run.id);
    await runService.saveReview(run.id, { invoice_number: '99887766' });
    await expect(
      fs.access(path.join(runRepository.runDir(run.id), 'normalized.json'))
    ).rejects.toMatchObject({
      code: 'ENOENT'
    });
    const second = await runService.renderRun(run.id);
    expect(first.filename).toBe('result-001.docx');
    expect(second.filename).toBe('result-002.docx');
    expect(await outputText(second.path)).toContain('发票号码：99887766');
  });

  it('rejects malformed persisted run artifacts on reload', async () => {
    const { runService, runRepository, templateService } = await createServices();
    await setupInvoiceTemplate(templateService);
    const run = await runService.createRun({ templateId: 'invoice-cn' });
    await runService.importExtraction(run.id, validExtraction);
    await fs.writeFile(path.join(runRepository.runDir(run.id), 'review.json'), '{not-json');
    await expect(runRepository.readReview(run.id)).rejects.toBeInstanceOf(InvalidRunArtifactError);
  });

  it('blocks rendering while required values are missing', async () => {
    const { runService, templateService } = await createServices();
    await setupInvoiceTemplate(templateService);
    const run = await runService.createRun({ templateId: 'invoice-cn' });
    await runService.importExtraction(
      run.id,
      `{"invoice_number": {"value": "12345678", "status": "found", "evidence": null}}`
    );
    await expect(runService.renderRun(run.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it('keeps attachments with the run and records their metadata', async () => {
    const { runService, runRepository, templateService } = await createServices();
    await setupInvoiceTemplate(templateService);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fillforge-attach-'));
    const source = path.join(dir, 'invoice.jpg');
    await fs.writeFile(source, 'image');
    const secondSource = path.join(dir, 'invoice.jpg');
    await fs.writeFile(secondSource, 'image-2');

    const run = await runService.createRun({
      templateId: 'invoice-cn',
      attachments: [
        { path: source, originalFilename: 'invoice.jpg', mediaType: 'image/jpeg' },
        {
          path: secondSource,
          originalFilename: 'invoice.jpg',
          mediaType: 'image/jpeg'
        }
      ]
    });
    const metadata = await runRepository.load(run.id);
    expect(metadata.attachments.map((a) => a.filename)).toEqual(['invoice.jpg', 'invoice-2.jpg']);
    const inputDir = path.join(runRepository.runDir(run.id), 'input');
    expect(await fs.readFile(path.join(inputDir, 'invoice-2.jpg'), 'utf8')).toBe('image-2');
  });
});

describe('decideReviewDecision', () => {
  it('classifies human decisions', () => {
    expect(decideReviewDecision('12345678', '12345678')).toBe('accepted');
    expect(decideReviewDecision('12345678', '12345679')).toBe('corrected');
    expect(decideReviewDecision(null, 'filled')).toBe('filled_manually');
    expect(decideReviewDecision('wrong', null)).toBe('rejected');
  });
});

describe('getEffectiveValues', () => {
  it('prefers reviewed values over model values and skips nulls', () => {
    const extraction: ExtractionResult = {
      a: { value: 'model', status: 'found', evidence: null },
      b: { value: null, status: 'ambiguous', evidence: null }
    };
    const review: ReviewedRecord = {
      schema_version: 1,
      fields: {
        a: {
          model_value: 'model',
          final_value: 'human',
          decision: 'corrected'
        },
        b: { model_value: null, final_value: null, decision: 'rejected' }
      }
    };
    expect(getEffectiveValues(extraction, review)).toEqual({ a: 'human' });
    expect(getEffectiveValues(extraction, null)).toEqual({ a: 'model' });
  });
});
