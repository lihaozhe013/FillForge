import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { atomicWriteFile } from "./atomic-write.ts";

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirectory(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

export async function readYamlFile(filePath: string): Promise<unknown> {
  const text = await fs.readFile(filePath, "utf8");
  return parseYaml(text);
}

export async function readJsonFile(filePath: string): Promise<unknown> {
  const text = await fs.readFile(filePath, "utf8");
  return JSON.parse(text);
}

export async function writeTextFileAtomic(filePath: string, text: string): Promise<void> {
  await atomicWriteFile(filePath, text);
}

export async function writeYamlFileAtomic(filePath: string, value: unknown): Promise<void> {
  await atomicWriteFile(filePath, stringifyYaml(value));
}

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function listSubdirectories(directory: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function readFileBinary(filePath: string): Promise<Uint8Array> {
  const buffer = await fs.readFile(filePath);
  return new Uint8Array(buffer);
}

export async function removePath(target: string): Promise<void> {
  await fs.rm(target, { recursive: true, force: true });
}

export async function copyFile(source: string, destination: string): Promise<void> {
  await fs.copyFile(source, destination);
}

/**
 * Copy a file into a directory, avoiding collisions by appending -2, -3, ...
 * while keeping the original extension. Returns the destination path.
 */
export async function copyFileWithCollisionAvoidance(
  sourceFile: string,
  destinationDirectory: string,
  filename = path.basename(sourceFile),
): Promise<string> {
  await ensureDirectory(destinationDirectory);
  const extension = path.extname(filename);
  const stem = extension ? filename.slice(0, -extension.length) : filename;
  let candidate = filename;
  let counter = 2;
  while (await pathExists(path.join(destinationDirectory, candidate))) {
    candidate = `${stem}-${counter}${extension}`;
    counter++;
  }
  const destination = path.join(destinationDirectory, candidate);
  await fs.copyFile(sourceFile, destination);
  return destination;
}
