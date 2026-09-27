import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  AppError,
  InvalidTemplateSchemaError,
  UnsupportedSchemaVersionError,
  writeYamlFileAtomic
} from '@fillforge/core';
import { createDocxtemplaterRenderer } from '@fillforge/docx';
import { describe, expect, it } from 'vitest';
import { computePlaceholderReport } from './inspect.ts';
import { FileTemplateRepository } from './repository.ts';
import { TemplateService } from './service.ts';

const FIXTURE_TEMPLATE = path.resolve(
  import.meta.dirname,
  '../../../tests/fixtures/templates/invoice/invoice-template.docx'
);

async function createTempTemplatesDir(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fillforge-repo-'));
  const templatesDir = path.join(home, '.local', 'fillforge', 'templates');
  await fs.mkdir(templatesDir, { recursive: true });
  return templatesDir;
}

async function createRepository(): Promise<FileTemplateRepository> {
  return new FileTemplateRepository(await createTempTemplatesDir());
}

describe('FileTemplateRepository', () => {
  it('creates a template by copying the DOCX and writing template.yaml', async () => {
    const repository = await createRepository();
    const template = await repository.create({
      id: 'invoice-cn',
      name: '中国发票',
      description: '从中国发票提取信息',
      documentPath: FIXTURE_TEMPLATE
    });
    expect(template.id).toBe('invoice-cn');
    const reloaded = await repository.load('invoice-cn');
    expect(reloaded.name).toBe('中国发票');
    const documentPath = await repository.getDocumentPath('invoice-cn');
    await expect(fs.access(documentPath)).resolves.toBeUndefined();
    const configText = await fs.readFile(
      path.join(path.dirname(documentPath), 'template.yaml'),
      'utf8'
    );
    expect(configText).toContain('schema_version: 1');
    expect(configText).toContain('name: 中国发票');
  });

  it('rejects duplicate ids', async () => {
    const repository = await createRepository();
    const input = { id: 'invoice-cn', name: '中国发票', documentPath: FIXTURE_TEMPLATE };
    await repository.create(input);
    await expect(repository.create(input)).rejects.toMatchObject({
      code: 'template_already_exists'
    });
  });

  it('lists created templates with summaries', async () => {
    const repository = await createRepository();
    await repository.create({
      name: 'Invoice CN',
      documentPath: FIXTURE_TEMPLATE
    });
    const summaries = await repository.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: 'invoice-cn',
      name: 'Invoice CN',
      hasDocument: true
    });
  });

  it('throws TemplateNotFoundError for unknown ids', async () => {
    const repository = await createRepository();
    await expect(repository.load('missing')).rejects.toMatchObject({
      code: 'template_not_found'
    });
  });

  it('rejects unsupported schema versions with a clear error', async () => {
    const repository = await createRepository();
    await repository.create({
      name: 'Invoice CN',
      documentPath: FIXTURE_TEMPLATE
    });
    const configFile = path.join(repository.templatesDir, 'invoice-cn', 'template.yaml');
    await writeYamlFileAtomic(configFile, {
      schema_version: 99,
      id: 'invoice-cn',
      name: 'x',
      document: { file: 'template.docx' },
      fields: {}
    });
    await expect(repository.load('invoice-cn')).rejects.toBeInstanceOf(
      UnsupportedSchemaVersionError
    );
  });

  it('rejects invalid configurations', async () => {
    const repository = await createRepository();
    await repository.create({
      name: 'Invoice CN',
      documentPath: FIXTURE_TEMPLATE
    });
    const configFile = path.join(repository.templatesDir, 'invoice-cn', 'template.yaml');
    await writeYamlFileAtomic(configFile, { schema_version: 1, id: 'nope' });
    await expect(repository.load('invoice-cn')).rejects.toBeInstanceOf(InvalidTemplateSchemaError);
  });

  it('duplicates templates with a new id and copied document', async () => {
    const repository = await createRepository();
    await repository.create({
      name: 'Invoice CN',
      documentPath: FIXTURE_TEMPLATE
    });
    const copy = await repository.duplicate('invoice-cn', 'invoice-backup');
    expect(copy.id).toBe('invoice-backup');
    expect(copy.name).toBe('Invoice CN (copy)');
    const documentPath = await repository.getDocumentPath('invoice-backup');
    expect(documentPath).toContain('invoice-backup');
  });

  it('deletes templates', async () => {
    const repository = await createRepository();
    await repository.create({
      name: 'Invoice CN',
      documentPath: FIXTURE_TEMPLATE
    });
    await repository.delete('invoice-cn');
    expect(await repository.list()).toEqual([]);
    await expect(repository.delete('invoice-cn')).rejects.toBeInstanceOf(AppError);
  });
});

describe('TemplateService', () => {
  it('creates same-name fields and bindings for imported placeholders', async () => {
    const templatesDir = await createTempTemplatesDir();
    const service = TemplateService.createDefault(templatesDir, createDocxtemplaterRenderer());
    const template = await service.importTemplate({
      id: 'invoice-cn',
      name: '中国发票',
      documentPath: FIXTURE_TEMPLATE
    });
    expect(Object.keys(template.fields)).toEqual([
      'invoice_date',
      'invoice_number',
      'seller_name',
      'total_amount'
    ]);
    expect(template.fields.invoice_number).toEqual({
      label: 'invoice_number',
      type: 'string',
      required: false
    });
    expect(template.bindings).toEqual({
      invoice_date: { source: 'invoice_date' },
      invoice_number: { source: 'invoice_number' },
      seller_name: { source: 'seller_name' },
      total_amount: { source: 'total_amount' }
    });
    const report = await service.inspectTemplate('invoice-cn');
    expect(report.placeholders).toEqual([
      'invoice_date',
      'invoice_number',
      'seller_name',
      'total_amount'
    ]);
    expect(report.unconfigured).toEqual([]);
    expect(report.unreferenced).toEqual([]);
  });

  it('syncs missing placeholders without replacing existing field settings or bindings', async () => {
    const templatesDir = await createTempTemplatesDir();
    const service = TemplateService.createDefault(templatesDir, createDocxtemplaterRenderer());
    await service.importTemplate({
      id: 'invoice-cn',
      name: '中国发票',
      documentPath: FIXTURE_TEMPLATE
    });
    const original = await service.loadTemplate('invoice-cn');
    const customBinding = { source: 'custom_source', transform: 'uppercase' };
    const legacy = {
      ...original,
      fields: {
        invoice_date: {
          label: 'Invoice date',
          description: 'Keep this description.',
          type: 'date' as const,
          required: true
        },
        custom_source: { label: 'Custom source', type: 'string' as const, required: true },
        legacy_unused: { label: 'Legacy field', type: 'string' as const, required: false }
      },
      bindings: { invoice_number: customBinding }
    };
    await service.saveSchema('invoice-cn', legacy);
    const synced = await service.syncPlaceholders('invoice-cn', legacy);
    expect(synced.fields.invoice_date).toEqual(legacy.fields.invoice_date);
    expect(synced.fields.invoice_number).toEqual({
      label: 'invoice_number',
      type: 'string',
      required: false
    });
    expect(synced.fields.custom_source).toEqual(legacy.fields.custom_source);
    expect(synced.fields.legacy_unused).toEqual(legacy.fields.legacy_unused);
    expect(synced.fields.invoice_date).toEqual({
      label: 'invoice_date',
      type: 'string',
      required: false
    });
    expect(synced.bindings?.invoice_number).toEqual(customBinding);
    expect(synced.bindings?.invoice_date).toEqual({ source: 'invoice_date' });
    expect(await service.syncPlaceholders('invoice-cn')).toEqual(synced);
    const report = await service.inspectTemplate('invoice-cn');
    expect(report.unconfigured).toEqual([]);
    expect(report.unreferenced).toEqual(['invoice_number', 'legacy_unused']);
  });

  it('rejects template document paths outside the template directory', async () => {
    const repository = await createRepository();
    const template = await repository.create({
      name: 'Invoice CN',
      documentPath: FIXTURE_TEMPLATE
    });
    await expect(
      repository.saveSchema('invoice-cn', {
        ...template,
        document: { file: '../outside.docx' }
      })
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('computePlaceholderReport', () => {
  it('classifies placeholders against bindings', () => {
    const report = computePlaceholderReport(
      { placeholders: ['a', 'b'] },
      {
        schema_version: 1,
        id: 'x',
        name: 'x',
        document: { file: 'template.docx' },
        fields: {
          fa: { label: 'A', type: 'string', required: true },
          fb: { label: 'B', type: 'string', required: true }
        },
        bindings: { a: { source: 'fa' } }
      }
    );
    expect(report.unconfigured).toEqual(['b']);
    expect(report.unreferenced).toEqual(['fb']);
  });
});
