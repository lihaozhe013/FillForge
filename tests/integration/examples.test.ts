import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createContext } from '@fillforge/tools';
import PizZip from 'pizzip';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const EXAMPLE_DIR = path.resolve(import.meta.dirname, '../../examples/invoice');
const TEMPLATE_DOCX = path.join(EXAMPLE_DIR, 'invoice-template.docx');
const TEMPLATE_CONFIG = path.join(EXAMPLE_DIR, 'template.yaml');
const EXTRACTION_INPUT = path.join(EXAMPLE_DIR, 'extraction-input.json');
const SOURCE_TEXT = path.join(EXAMPLE_DIR, 'source-text.txt');

const PLACEHOLDERS = [
  'buyer_name',
  'invoice_day',
  'invoice_month',
  'invoice_number',
  'invoice_year',
  'seller_name',
  'total_amount',
  'total_amount_uppercase'
];

let home: string;
const previousHome = process.env.FILLFORGE_HOME;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'fillforge-examples-'));
  process.env.FILLFORGE_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.FILLFORGE_HOME;
  } else {
    process.env.FILLFORGE_HOME = previousHome;
  }
});

async function documentText(docxPath: string): Promise<string> {
  const buffer = await fs.readFile(docxPath);
  return (
    new PizZip(buffer)
      .file('word/document.xml')
      ?.asText()
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim() ?? ''
  );
}

describe('examples/invoice is a working end-to-end example', () => {
  it('imports, inspects, extracts, reviews, and renders with the shipped files only', async () => {
    const session = await createContext();
    await session.templateService.importTemplate({
      id: 'invoice',
      name: 'Invoice',
      documentPath: TEMPLATE_DOCX
    });
    await fs.copyFile(
      TEMPLATE_CONFIG,
      path.join(home, '.local/fillforge/templates/invoice/template.yaml')
    );

    // The shipped template.yaml parses and the shipped DOCX matches it exactly:
    // every placeholder is bound and every field is referenced.
    const configured = await session.templateService.loadTemplate('invoice');
    expect(configured.id).toBe('invoice');
    expect(Object.keys(configured.fields).sort()).toEqual([
      'buyer_name',
      'invoice_date',
      'invoice_number',
      'seller_name',
      'total_amount'
    ]);
    const report = await session.templateService.inspectTemplate('invoice');
    expect(report.placeholders).toEqual(PLACEHOLDERS);
    expect(report.unconfigured).toEqual([]);
    expect(report.unreferenced).toEqual([]);

    // The prompt is derivable from the shipped configuration alone.
    const run = await session.runService.createRun({ templateId: 'invoice' });
    const prompt = await session.runService.generatePrompt(run.id);
    for (const field of Object.keys(configured.fields)) {
      expect(prompt).toContain(field);
    }

    // The shipped AI answer validates cleanly and renders every binding.
    const raw = await fs.readFile(EXTRACTION_INPUT, 'utf8');
    const { result, issues } = await session.runService.importExtraction(run.id, raw);
    expect(issues).toEqual([]);
    expect(result.total_amount?.value).toBe(18650.5);
    await session.runService.saveReview(run.id, {});
    const artifact = await session.runService.renderRun(run.id);

    // Labels and placeholders live in separate table cells, so assert on the
    // inserted values themselves (tag stripping would glue cells together).
    const text = await documentText(artifact.path);
    expect(text).toContain('INV-2026-00418');
    expect(text).toContain('2026-03-17');
    expect(text).toContain('Northwind Trading Co., Ltd.');
    expect(text).toContain('Contoso Studio LLC');
    expect(text).toContain('18650.5');
    expect(text).toContain('壹万捌仟陆佰伍拾元伍角整');
    expect(text).not.toMatch(/\{[A-Za-z_]+\}/);
  });

  it('keeps the fake source text consistent with the shipped extraction result', async () => {
    const [source, extraction] = await Promise.all([
      fs.readFile(SOURCE_TEXT, 'utf8'),
      fs.readFile(EXTRACTION_INPUT, 'utf8')
    ]);
    const parsed = JSON.parse(extraction) as Record<string, { value: unknown }>;
    for (const [key, entry] of Object.entries(parsed)) {
      const needle = key === 'total_amount' ? '18,650.50' : String(entry.value);
      expect(source, `${key} value should appear in source-text.txt`).toContain(needle);
    }
  });
});
