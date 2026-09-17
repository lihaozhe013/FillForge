import { describe, expect, it } from 'vitest';
import { appConfigSchema, resolveAppConfig } from './config.ts';
import {
  EXTRACTION_STATUS_VALUES,
  extractedFieldSchema,
  extractionResultSchema
} from './extraction.ts';
import { fieldDefinitionSchema } from './field.ts';
import { REVIEW_SCHEMA_VERSION, reviewedRecordSchema, runMetadataSchema } from './run.ts';
import { TEMPLATE_SCHEMA_VERSION, templateSchema } from './template.ts';

const invoiceTemplate = {
  schema_version: 1,
  id: 'invoice-cn',
  name: '中国发票',
  description: '从中国发票提取信息并生成目标文档',
  document: { file: 'template.docx' },
  fields: {
    invoice_number: {
      label: '发票号码',
      description: '发票上明确标注的发票号码',
      type: 'string',
      required: true,
      extraction: {
        instruction: '找到明确标记为“发票号码”的值。'
      },
      normalization: { trim: true, remove_spaces: true },
      validation: { regex: '^[0-9A-Za-z-]+$' }
    },
    invoice_date: {
      label: '开票日期',
      type: 'date',
      required: true,
      extraction: { instruction: '提取票面上标记为开票日期的日期。' },
      output: { format: 'YYYY-MM-DD' }
    },
    total_amount: {
      label: '价税合计',
      type: 'number',
      required: true
    }
  },
  bindings: {
    invoice_number: { source: 'invoice_number' },
    invoice_year: { source: 'invoice_date', transform: 'date_year' },
    total_amount: { source: 'total_amount' }
  }
};

describe('templateSchema', () => {
  it('accepts a complete invoice template configuration', () => {
    const parsed = templateSchema.parse(invoiceTemplate);
    expect(parsed.id).toBe('invoice-cn');
    expect(parsed.fields.invoice_number?.type).toBe('string');
    expect(parsed.bindings?.invoice_year).toEqual({
      source: 'invoice_date',
      transform: 'date_year'
    });
  });

  it('applies defaults for type and required', () => {
    const parsed = templateSchema.parse({
      ...invoiceTemplate,
      fields: {
        seller_name: { label: '销售方名称' }
      },
      bindings: undefined
    });
    const seller = parsed.fields.seller_name;
    expect(seller?.type).toBe('string');
    expect(seller?.required).toBe(true);
  });

  it('rejects an unsupported schema version', () => {
    const result = templateSchema.safeParse({
      ...invoiceTemplate,
      schema_version: TEMPLATE_SCHEMA_VERSION + 1
    });
    expect(result.success).toBe(false);
  });

  it('rejects a field without a label', () => {
    const result = templateSchema.safeParse({
      ...invoiceTemplate,
      fields: { broken: { type: 'string' } }
    });
    expect(result.success).toBe(false);
  });

  it('rejects non machine-friendly template ids', () => {
    const result = templateSchema.safeParse({
      ...invoiceTemplate,
      id: 'Invoice CN!'
    });
    expect(result.success).toBe(false);
  });
});

describe('fieldDefinitionSchema', () => {
  it('keeps normalization and validation independent', () => {
    const parsed = fieldDefinitionSchema.parse({
      label: '金额',
      type: 'number',
      validation: { minimum: 0 }
    });
    expect(parsed.validation?.minimum).toBe(0);
    expect(parsed.normalization).toBeUndefined();
  });
});

describe('extractionResultSchema', () => {
  it('accepts the documented AI output contract', () => {
    const result = extractionResultSchema.parse({
      invoice_number: {
        value: '12345678',
        status: 'found',
        evidence: '发票号码：12345678'
      },
      seller_name: {
        value: null,
        status: 'ambiguous',
        evidence: null
      },
      remark: {
        value: null,
        status: 'not_found',
        evidence: null
      }
    });
    expect(Object.keys(result)).toHaveLength(3);
  });

  it('rejects unknown statuses', () => {
    const result = extractionResultSchema.safeParse({
      invoice_number: { value: '1', status: 'probable', evidence: null }
    });
    expect(result.success).toBe(false);
  });

  it('exposes the minimum status values', () => {
    expect(EXTRACTION_STATUS_VALUES).toEqual(['found', 'not_found', 'ambiguous']);
  });

  it('validates a single extracted field shape', () => {
    const parsed = extractedFieldSchema.parse({
      value: 42,
      status: 'found',
      evidence: null
    });
    expect(parsed.status).toBe('found');
  });
});

describe('runMetadataSchema', () => {
  it('accepts spec-shaped metadata', () => {
    const parsed = runMetadataSchema.parse({
      schema_version: 1,
      id: '01K5AEXAMP5EXAMP5EXAMP5555',
      created_at: '2026-09-16T12:30:00.000Z',
      template_id: 'invoice-cn',
      template_schema_version: 1,
      prompt_version: 'fillforge-extraction-v1',
      attachments: [
        {
          filename: 'invoice.jpg',
          original_filename: 'invoice.jpg',
          media_type: 'image/jpeg'
        }
      ]
    });
    expect(parsed.attachments).toHaveLength(1);
  });

  it('defaults attachments to an empty list', () => {
    const parsed = runMetadataSchema.parse({
      schema_version: 1,
      id: '01K5AEXAMP5EXAMP5EXAMP5555',
      created_at: '2026-09-16T12:30:00.000Z',
      template_id: 'invoice-cn',
      template_schema_version: 1,
      prompt_version: 'fillforge-extraction-v1'
    });
    expect(parsed.attachments).toEqual([]);
  });

  it('rejects invalid timestamps', () => {
    const result = runMetadataSchema.safeParse({
      schema_version: 1,
      id: '01K5AEXAMP5EXAMP5EXAMP5555',
      created_at: 'yesterday',
      template_id: 'invoice-cn',
      template_schema_version: 1,
      prompt_version: 'fillforge-extraction-v1'
    });
    expect(result.success).toBe(false);
  });
});

describe('reviewedRecordSchema', () => {
  it('accepts spec-shaped review data', () => {
    const parsed = reviewedRecordSchema.parse({
      schema_version: REVIEW_SCHEMA_VERSION,
      fields: {
        invoice_number: {
          model_value: '12345678',
          final_value: '12345679',
          decision: 'corrected'
        },
        invoice_date: {
          model_value: '2026-09-16',
          final_value: '2026-09-16',
          decision: 'accepted'
        }
      }
    });
    expect(parsed.fields.invoice_number?.decision).toBe('corrected');
  });
});

describe('appConfigSchema', () => {
  it('fills defaults for an almost empty config', () => {
    const parsed = appConfigSchema.parse({ schema_version: 1 });
    const resolved = resolveAppConfig(parsed);
    expect(resolved.theme).toBe('system');
    expect(resolved.showAdvancedFields).toBe(false);
    expect(resolved.promptVersion).toBe('fillforge-extraction-v1');
  });

  it('rejects unknown themes', () => {
    const result = appConfigSchema.safeParse({
      schema_version: 1,
      ui: { theme: 'neon' }
    });
    expect(result.success).toBe(false);
  });
});
