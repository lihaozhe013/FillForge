import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

const FIXTURES = path.resolve(import.meta.dirname, "../../../tests/fixtures");
const INVOICE_DOCX = path.join(FIXTURES, "templates/invoice/invoice-template.docx");
const INVOICE_CONFIG = path.join(FIXTURES, "templates/invoice/template.yaml");
const VALID_EXTRACTION = path.join(FIXTURES, "extraction/invoice-valid.json");

let home: string;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "docufill-tools-"));
  process.env.DOCUFILL_HOME = home;
});

async function prepareTemplate(): Promise<void> {
  const { createContext } = await import("./context.ts");
  const context = await createContext();
  await context.templateService.importTemplate({
    id: "invoice-cn",
    name: "中国发票",
    documentPath: INVOICE_DOCX,
  });
  // Use the fixture configuration file as-is.
  await fs.copyFile(
    INVOICE_CONFIG,
    path.join(home, ".local/docufill/templates/invoice-cn/template.yaml"),
  );
  await context.runService.createRun({ templateId: "invoice-cn" });
}

describe("CLI commands", () => {
  it("inspect-template reports placeholders and gaps", async () => {
    await prepareTemplate();
    const { inspectTemplate } = await import("./inspect-template.ts");
    const { createContext } = await import("./context.ts");
    const output = await inspectTemplate(await createContext(), "invoice-cn");
    expect(output).toContain("中国发票");
    expect(output).toContain("invoice_number");
    expect(output).toContain("Placeholders (4)");
    // The fixture configuration binds every placeholder.
    expect(output).not.toContain("Unconfigured placeholders");
  });

  it("extract-fields prints the deterministic prompt", async () => {
    await prepareTemplate();
    const { extractFields } = await import("./extract-fields.ts");
    const { createContext } = await import("./context.ts");
    const output = await extractFields(await createContext(), "invoice-cn");
    expect(output).toContain("invoice_number");
    expect(output).toContain("Expected JSON structure");
  });

  it("validate-fields accepts the valid fixture", async () => {
    await prepareTemplate();
    const { validateFields } = await import("./validate-fields.ts");
    const { createContext } = await import("./context.ts");
    const output = await validateFields(await createContext(), "invoice-cn", VALID_EXTRACTION, {
      normalize: true,
    });
    expect(output).toContain("OK");
    expect(output).toContain("2026-09-16");
  });

  it("render-document renders a reviewed run", async () => {
    await prepareTemplate();
    const { createContext } = await import("./context.ts");
    const { renderDocument } = await import("./render-document.ts");
    const context = await createContext();

    const runs = await context.runService.listRuns();
    const run = runs[0];
    if (!run) {
      throw new Error("expected a run");
    }
    const raw = await fs.readFile(VALID_EXTRACTION, "utf8");
    await context.runService.importExtraction(run.id, raw);
    await context.runService.saveReview(run.id, {});

    const output = await renderDocument(context, run.id);
    expect(output).toContain("result-001.docx");
    expect(output).toContain(path.join(home, ".local/docufill/runs"));
  });
});

describe("main dispatch", () => {
  it("prints help", async () => {
    const { main } = await import("./index.ts");
    expect(await main([])).toContain("Docufill CLI");
  });

  it("rejects unknown commands", async () => {
    const { main } = await import("./index.ts");
    await expect(main(["nope"])).rejects.toThrow("Unknown command: nope");
  });
});
