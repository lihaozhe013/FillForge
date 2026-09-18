import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileConfigRepository } from './config.ts';
import { InvalidConfigError, UnsupportedSchemaVersionError } from './errors.ts';

async function createRepository() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'fillforge-config-'));
  return new FileConfigRepository(path.join(directory, 'config.yaml'));
}

describe('FileConfigRepository', () => {
  it('returns stable defaults without creating a file on first load', async () => {
    const repository = await createRepository();
    expect(await repository.loadResolved()).toEqual({
      theme: 'system',
      language: 'system',
      showAdvancedFields: false,
      promptVersion: 'fillforge-extraction-v1'
    });
    await expect(fs.access(repository.configFile)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('writes a readable versioned YAML configuration', async () => {
    const repository = await createRepository();
    await repository.save({
      schema_version: 1,
      ui: { theme: 'dark', language: 'zh-CN' },
      editor: { show_advanced_fields: true },
      extraction: { prompt_version: 'custom-v2' }
    });
    const text = await fs.readFile(repository.configFile, 'utf8');
    expect(text).toContain('schema_version: 1');
    expect(await repository.loadResolved()).toEqual({
      theme: 'dark',
      language: 'zh-CN',
      showAdvancedFields: true,
      promptVersion: 'custom-v2'
    });
  });

  it('rejects newer schema versions and malformed configuration', async () => {
    const repository = await createRepository();
    await fs.writeFile(repository.configFile, 'schema_version: 99\n');
    await expect(repository.load()).rejects.toBeInstanceOf(UnsupportedSchemaVersionError);

    await fs.writeFile(repository.configFile, 'schema_version: 1\nui:\n  theme: neon\n');
    await expect(repository.load()).rejects.toBeInstanceOf(InvalidConfigError);
  });
});
