import fs from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from '@fillforge/core';
import type { TemplateSchema } from '@fillforge/schema';
import { describe, expect, it } from 'vitest';
import { ExtractionParseError } from './errors.ts';
import { buildExpectedJson, buildExtractionPrompt } from './prompt-builder.ts';
import { parseExtractionResult, stripMarkdownFences } from './result-parser.ts';

const FIXTURES = path.resolve(import.meta.dirname, '../../../tests/fixtures');

const invoiceTemplate: TemplateSchema = {
  schema_version: 1,
  id: 'invoice-cn',
  name: '中国发票',
  description: '从中国发票提取信息并生成目标文档',
  document: { file: 'invoice-template.docx' },
  fields: {
    invoice_number: {
      label: '发票号码',
      description: '发票上明确标注的发票号码',
      type: 'string',
      required: true,
      extraction: {
        instruction: '找到明确标记为“发票号码”的值。不要将“发票代码”作为发票号码。'
      }
    },
    invoice_date: {
      label: '开票日期',
      type: 'date',
      required: true,
      output: { format: 'YYYY-MM-DD' }
    },
    total_amount: {
      label: '价税合计',
      type: 'number',
      required: true
    }
  }
};

describe('buildExtractionPrompt', () => {
  it('is deterministic for a given template', () => {
    const first = buildExtractionPrompt(invoiceTemplate);
    const second = buildExtractionPrompt(invoiceTemplate);
    expect(first.prompt).toBe(second.prompt);
    expect(first.expectedJson).toBe(second.expectedJson);
    expect(first.promptVersion).toBe('fillforge-extraction-v1');
  });

  it('matches the golden prompt for the invoice fixture', () => {
    const { prompt } = buildExtractionPrompt(invoiceTemplate);
    expect(prompt).toMatchSnapshot();
  });

  it('mentions labels, types, and extraction rules', () => {
    const { prompt } = buildExtractionPrompt(invoiceTemplate);
    expect(prompt).toContain('invoice_number');
    expect(prompt).toContain('Meaning: 发票号码');
    expect(prompt).toContain('Type: number');
    expect(prompt).toContain('不要将“发票代码”作为发票号码');
    expect(prompt).toContain('found, not_found, or ambiguous');
    expect(prompt).toContain('Return valid JSON only');
  });

  it('describes the expected JSON shape', () => {
    const json = buildExpectedJson(invoiceTemplate.fields);
    const parsed = JSON.parse(json) as Record<string, Record<string, string>>;
    expect(parsed.invoice_number?.value).toBe('string or null');
    expect(parsed.total_amount?.value).toBe('number or null');
    expect(parsed.invoice_date?.value).toBe('date string (YYYY-MM-DD) or null');
    expect(parsed.invoice_number?.status).toBe('found | not_found | ambiguous');
  });

  it('rejects templates without fields', () => {
    const empty: TemplateSchema = {
      ...invoiceTemplate,
      fields: {}
    };
    expect(() => buildExtractionPrompt(empty)).toThrow(/no configured fields/);
  });
});

describe('stripMarkdownFences', () => {
  it('keeps plain JSON untouched', () => {
    expect(stripMarkdownFences('{"a":1}')).toBe('{"a":1}');
  });

  it('strips a ```json fence', () => {
    const fenced = '```json\n{"a": 1}\n```';
    expect(stripMarkdownFences(fenced)).toBe('{"a": 1}');
  });

  it('strips a fence without a language tag', () => {
    const fenced = '```\n{"a": 1}\n```';
    expect(stripMarkdownFences(fenced)).toBe('{"a": 1}');
  });

  it('tolerates trailing whitespace and newlines', () => {
    const fenced = '```json\n{"a": 1}\n```\n\n  ';
    expect(stripMarkdownFences(fenced)).toBe('{"a": 1}');
  });
});

describe('parseExtractionResult', () => {
  it('parses the valid invoice fixture', async () => {
    const raw = await fs.readFile(path.join(FIXTURES, 'extraction/invoice-valid.json'), 'utf8');
    const result = parseExtractionResult(raw);
    expect(result.invoice_number).toEqual({
      value: '12345678',
      status: 'found',
      evidence: '发票号码：12345678'
    });
  });

  it('parses JSON inside a markdown fence', async () => {
    const raw = await fs.readFile(path.join(FIXTURES, 'extraction/invoice-fenced.md'), 'utf8');
    const result = parseExtractionResult(raw);
    expect(result.seller_name?.status).toBe('ambiguous');
    expect(result.total_amount?.status).toBe('not_found');
  });

  it('throws ExtractionParseError for malformed JSON', async () => {
    const raw = await fs.readFile(path.join(FIXTURES, 'extraction/malformed.json'), 'utf8');
    expect(() => parseExtractionResult(raw)).toThrow(ExtractionParseError);
  });

  it('throws ValidationError for structurally wrong payloads', () => {
    expect(() => parseExtractionResult('{"invoice_number": {"value": "1"}}')).toThrow(
      ValidationError
    );
    expect(() =>
      parseExtractionResult(
        '{"invoice_number": {"value": "1", "status": "maybe", "evidence": null}}'
      )
    ).toThrow(ValidationError);
  });
});
