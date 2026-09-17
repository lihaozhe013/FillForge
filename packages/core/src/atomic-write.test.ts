import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { atomicWriteFile } from './atomic-write.ts';

async function tempFile(name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fillforge-atomic-'));
  return path.join(dir, name);
}

describe('atomicWriteFile', () => {
  it('writes the full content to the target', async () => {
    const target = await tempFile('state.json');
    await atomicWriteFile(target, JSON.stringify({ ok: true }, null, 2));
    const content = await fs.readFile(target, 'utf8');
    expect(JSON.parse(content)).toEqual({ ok: true });
  });

  it('overwrites an existing file atomically', async () => {
    const target = await tempFile('review.json');
    await atomicWriteFile(target, 'first');
    await atomicWriteFile(target, 'second');
    expect(await fs.readFile(target, 'utf8')).toBe('second');
  });

  it('leaves no temp files behind', async () => {
    const target = await tempFile('data.yaml');
    await atomicWriteFile(target, 'key: value');
    const dir = path.dirname(target);
    const entries = await fs.readdir(dir);
    expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('writes binary content', async () => {
    const target = await tempFile('blob.bin');
    const payload = new Uint8Array([1, 2, 3, 250]);
    await atomicWriteFile(target, payload);
    const read = await fs.readFile(target);
    expect([...read]).toEqual([...payload]);
  });

  it('removes the temp file when the rename fails', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fillforge-atomic-'));
    // A directory at the target path makes the final rename fail (EISDIR).
    await fs.mkdir(path.join(dir, 'occupied.txt'));
    await expect(atomicWriteFile(path.join(dir, 'occupied.txt'), 'x')).rejects.toThrow();
    const entries = await fs.readdir(dir);
    expect(entries.filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });
});
