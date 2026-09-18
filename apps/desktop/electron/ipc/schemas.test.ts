import { describe, expect, it } from 'vitest';
import {
  runsCreateSchema,
  runsLoadSchema,
  runsSaveReviewSchema,
  settingsSaveSchema,
  systemPathSchema,
  templatesLoadSchema
} from './schemas.ts';

describe('IPC request schemas', () => {
  it('accepts valid template and ULID run identifiers', () => {
    expect(templatesLoadSchema.safeParse({ id: 'invoice-cn' }).success).toBe(true);
    expect(runsLoadSchema.safeParse({ id: '01K5AEXAMP5EXAMP5EXAMP5555' }).success).toBe(true);
  });

  it('rejects traversal-shaped identifiers and renderer attachment paths', () => {
    expect(templatesLoadSchema.safeParse({ id: '../outside' }).success).toBe(false);
    expect(runsLoadSchema.safeParse({ id: '../outside' }).success).toBe(false);
    expect(
      runsCreateSchema.safeParse({ templateId: 'invoice-cn', attachmentPaths: ['/tmp/a'] }).success
    ).toBe(false);
  });

  it('keeps filesystem paths limited to dedicated path operations', () => {
    expect(systemPathSchema.safeParse({ path: '/tmp/result.docx' }).success).toBe(true);
    expect(
      runsSaveReviewSchema.safeParse({ id: '01K5AEXAMP5EXAMP5EXAMP5555', finalValues: {} }).success
    ).toBe(true);
  });

  it('validates settings before persistence', () => {
    expect(
      settingsSaveSchema.safeParse({
        theme: 'dark',
        language: 'zh-CN',
        showAdvancedFields: true,
        promptVersion: 'fillforge-extraction-v1'
      }).success
    ).toBe(true);
    expect(
      settingsSaveSchema.safeParse({
        theme: 'neon',
        language: 'zh-CN',
        showAdvancedFields: true,
        promptVersion: 'fillforge-extraction-v1'
      }).success
    ).toBe(false);
    expect(
      settingsSaveSchema.safeParse({
        theme: 'dark',
        language: 'fr',
        showAdvancedFields: true,
        promptVersion: 'fillforge-extraction-v1'
      }).success
    ).toBe(false);
  });
});
