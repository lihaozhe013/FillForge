import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createContext } from "@docufill/tools";
import PizZip from "pizzip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const FIXTURES = path.resolve(import.meta.dirname, "../fixtures");
const INVOICE_DOCX = path.join(FIXTURES, "templates/invoice/invoice-template.docx");
const INVOICE_CONFIG = path.join(FIXTURES, "templates/invoice/template.yaml");
const VALID_EXTRACTION = path.join(FIXTURES, "extraction/invoice-valid.json");

let home: string;
const previousHome = process.env.DOCUFILL_HOME;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), "docufill-integration-"));
  process.env.DOCUFILL_HOME = home;
});

afterEach(() => {
  if (previousHome === undefined) {
    delete process.env.DOCUFILL_HOME;
  } else {
    process.env.DOCUFILL_HOME = previousHome;
  }
});

function documentText(docxPath: string): Promise<string> {
  return fs.readFile(docxPath).then(
    (buffer) =>
      new PizZip(buffer)
        .file("word/document.xml")
        ?.asText()
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim() ?? "",
  );
}

describe("MVP workflow (fixture driven)", () => {
  it("goes from DOCX import to a rendered, reopenable run", async () => {
    // 1-2. Import the invoice DOCX and detect placeholders.
    const firstSession = await createContext();
    const template = await firstSession.templateService.importTemplate({
      id: "invoice-cn",
      name: "中国发票",
      documentPath: INVOICE_DOCX,
    });
    expect(template.id).toBe("invoice-cn");
    const report = await firstSession.templateService.inspectTemplate("invoice-cn");
    expect(report.placeholders).toEqual([
      "invoice_date",
      "invoice_number",
      "seller_name",
      "total_amount",
    ]);

    // 3-5. Apply the semantic field configuration and persist template.yaml.
    await fs.copyFile(
      INVOICE_CONFIG,
      path.join(home, ".local/docufill/templates/invoice-cn/template.yaml"),
    );
    const configured = await firstSession.templateService.loadTemplate("invoice-cn");
    expect(Object.keys(configured.fields)).toEqual([
      "invoice_number",
      "invoice_date",
      "seller_name",
      "total_amount",
    ]);
    const yamlOnDisk = await fs.readFile(
      path.join(home, ".local/docufill/templates/invoice-cn/template.yaml"),
      "utf8",
    );
    expect(yamlOnDisk).toContain("label: 发票号码");
    expect(yamlOnDisk).toContain("schema_version: 1");

    // 6-8. Create a run, attach evidence, generate the prompt.
    const attachmentSource = path.join(home, "invoice-source.jpg");
    await fs.writeFile(attachmentSource, "image-bytes");
    const run = await firstSession.runService.createRun({
      templateId: "invoice-cn",
      attachments: [
        {
          path: attachmentSource,
          originalFilename: "invoice.jpg",
          mediaType: "image/jpeg",
        },
      ],
    });
    const prompt = await firstSession.runService.generatePrompt(run.id);
    expect(prompt).toContain("invoice_number");
    expect(prompt).toContain("found, not_found, or ambiguous");

    // 9-10. The prompt file is stored in the run directory.
    const promptFile = await fs.readFile(
      path.join(home, ".local/docufill/runs", run.id, "prompt.md"),
      "utf8",
    );
    expect(promptFile).toContain("Expected JSON structure");

    // 11-14. Import the AI result and validate it.
    const raw = await fs.readFile(VALID_EXTRACTION, "utf8");
    const { result, issues } = await firstSession.runService.importExtraction(run.id, raw);
    expect(result.invoice_number?.value).toBe("12345678");
    expect(issues).toEqual([]);

    // 15-18. Review, correct one field, keep the model value intact.
    const review = await firstSession.runService.saveReview(run.id, {
      seller_name: "更正后的销售方名称",
    });
    expect(review.fields.seller_name).toMatchObject({
      model_value: "示例科技有限公司",
      final_value: "更正后的销售方名称",
      decision: "corrected",
    });
    const extractionOnDisk = JSON.parse(
      await fs.readFile(path.join(home, ".local/docufill/runs", run.id, "extraction.json"), "utf8"),
    ) as { seller_name: { value: string } };
    expect(extractionOnDisk.seller_name.value).toBe("示例科技有限公司");

    // 19. Render the final DOCX deterministically.
    const artifact = await firstSession.runService.renderRun(run.id);
    const text = await documentText(artifact.path);
    expect(text).toContain("发票号码：12345678");
    expect(text).toContain("销售方：更正后的销售方名称");
    expect(text).not.toContain("{seller_name}");
  });

  it("preserves everything across an application restart using files only", async () => {
    const firstSession = await createContext();
    await firstSession.templateService.importTemplate({
      id: "invoice-cn",
      name: "中国发票",
      documentPath: INVOICE_DOCX,
    });
    await fs.copyFile(
      INVOICE_CONFIG,
      path.join(home, ".local/docufill/templates/invoice-cn/template.yaml"),
    );
    const run = await firstSession.runService.createRun({ templateId: "invoice-cn" });
    const raw = await fs.readFile(VALID_EXTRACTION, "utf8");
    await firstSession.runService.importExtraction(run.id, raw);
    await firstSession.runService.saveReview(run.id, {});
    await firstSession.runService.renderRun(run.id);

    // Simulate an application restart: brand-new service instances, same files.
    const secondSession = await createContext();
    const templates = await secondSession.templateService.listTemplates();
    expect(templates.map((summary) => summary.id)).toEqual(["invoice-cn"]);
    const runs = await secondSession.runService.listRuns();
    expect(runs).toHaveLength(1);

    const details = await secondSession.runService.getRun(run.id);
    expect(details.extraction?.invoice_number?.value).toBe("12345678");
    expect(details.review?.fields.seller_name?.decision).toBe("accepted");
    expect(details.outputs.map((output) => output.filename)).toEqual([
      "result-001.docx",
      "result.docx",
    ]);

    // The run directory is inspectable with a plain file listing.
    // prompt.md is absent because this run never generated a prompt.
    const entries = await fs.readdir(path.join(home, ".local/docufill/runs", run.id));
    expect(entries.sort()).toEqual([
      "extraction.json",
      "input",
      "metadata.json",
      "normalized.json",
      "output",
      "review.json",
    ]);
  });
});
