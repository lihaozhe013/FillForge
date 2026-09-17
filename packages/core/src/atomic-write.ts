import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Write a file so that a crash can never leave a partially written target.
 * The temp file is created in the destination directory (same filesystem so
 * rename is atomic), flushed to disk, then renamed into place.
 */
export async function atomicWriteFile(target: string, data: string | Uint8Array): Promise<void> {
  const directory = path.dirname(target);
  await fs.mkdir(directory, { recursive: true });
  const tempFile = path.join(
    directory,
    `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`
  );
  const handle = await fs.open(tempFile, 'wx');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(tempFile, target);
  } catch (error) {
    await fs.rm(tempFile, { force: true });
    throw error;
  }
}
