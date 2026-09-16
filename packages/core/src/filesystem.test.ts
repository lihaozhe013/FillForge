import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  copyFileWithCollisionAvoidance,
  ensureDirectory,
  listSubdirectories,
  pathExists,
  readJsonFile,
  readYamlFile,
  writeJsonFileAtomic,
  writeTextFileAtomic,
  writeYamlFileAtomic,
} from "./filesystem.ts";

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `docufill-${prefix}-`));
}

describe("filesystem helpers", () => {
  it("detects existing and missing paths", async () => {
    const dir = await tempDir("exists");
    const file = path.join(dir, "note.txt");
    expect(await pathExists(file)).toBe(false);
    await writeTextFileAtomic(file, "hello");
    expect(await pathExists(file)).toBe(true);
  });

  it("round-trips YAML documents", async () => {
    const dir = await tempDir("yaml");
    const file = path.join(dir, "template.yaml");
    const value = {
      schema_version: 1,
      name: "中国发票",
      fields: { invoice_number: { label: "发票号码", type: "string" } },
    };
    await writeYamlFileAtomic(file, value);
    expect(await readYamlFile(file)).toEqual(value);
    const text = await fs.readFile(file, "utf8");
    expect(text).toContain("schema_version: 1");
    expect(text).toContain("发票号码");
  });

  it("round-trips JSON documents", async () => {
    const dir = await tempDir("json");
    const file = path.join(dir, "metadata.json");
    await writeJsonFileAtomic(file, { schema_version: 1, id: "01K5A" });
    expect(await readJsonFile(file)).toEqual({
      schema_version: 1,
      id: "01K5A",
    });
  });

  it("lists subdirectories in sorted order", async () => {
    const dir = await tempDir("list");
    await ensureDirectory(path.join(dir, "runs-b"));
    await ensureDirectory(path.join(dir, "runs-a"));
    await fs.writeFile(path.join(dir, "stray-file.txt"), "x");
    expect(await listSubdirectories(dir)).toEqual(["runs-a", "runs-b"]);
  });

  it("returns an empty list for a missing directory", async () => {
    expect(await listSubdirectories("/definitely/missing/dir")).toEqual([]);
  });

  it("avoids filename collisions when copying attachments", async () => {
    const dir = await tempDir("copy");
    const source = path.join(dir, "invoice.jpg");
    await fs.writeFile(source, "binary-ish");

    const targetDir = path.join(dir, "input");
    const first = await copyFileWithCollisionAvoidance(source, targetDir);
    const second = await copyFileWithCollisionAvoidance(source, targetDir);
    const third = await copyFileWithCollisionAvoidance(source, targetDir, "supporting.pdf");

    expect(path.basename(first)).toBe("invoice.jpg");
    expect(path.basename(second)).toBe("invoice-2.jpg");
    expect(path.basename(third)).toBe("supporting.pdf");
    expect(await fs.readFile(second, "utf8")).toBe("binary-ish");
  });
});
