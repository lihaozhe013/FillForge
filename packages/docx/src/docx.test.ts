import fs from "node:fs/promises";
import path from "node:path";
import PizZip from "pizzip";
import { describe, expect, it } from "vitest";
import { createDocxtemplaterRenderer } from "./docxtemplater-renderer.ts";
import { DocxInspectionError, DocxRenderError } from "./errors.ts";
import { normalizeTag } from "./inspector.ts";

const FIXTURES = path.resolve(import.meta.dirname, "../../../tests/fixtures/templates");

async function readFixture(relativePath: string): Promise<Uint8Array> {
  return fs.readFile(path.join(FIXTURES, relativePath));
}

async function documentText(docx: Uint8Array): Promise<string> {
  const zip = new PizZip(Buffer.from(docx));
  const xml = zip.file("word/document.xml")?.asText() ?? "";
  return xml
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("normalizeTag", () => {
  it("keeps simple tags and drops loop markers and filters", () => {
    expect(normalizeTag("invoice_number")).toBe("invoice_number");
    expect(normalizeTag(" total_amount ")).toBe("total_amount");
    expect(normalizeTag("title | uppercase")).toBe("title");
    expect(normalizeTag("#items")).toBeNull();
    expect(normalizeTag("/items")).toBeNull();
    expect(normalizeTag("^items")).toBeNull();
    expect(normalizeTag("")).toBeNull();
  });
});

describe("DocxtemplaterRenderer.inspect", () => {
  it("discovers all placeholders in the invoice fixture", async () => {
    const renderer = createDocxtemplaterRenderer();
    const inspection = await renderer.inspect(await readFixture("invoice/invoice-template.docx"));
    expect(inspection.placeholders).toEqual([
      "invoice_date",
      "invoice_number",
      "seller_name",
      "total_amount",
    ]);
  });

  it("finds placeholders split across XML runs", async () => {
    const renderer = createDocxtemplaterRenderer();
    const inspection = await renderer.inspect(await readFixture("simple/split-run-template.docx"));
    expect(inspection.placeholders).toContain("customer_name");
  });

  it("throws a domain error for a corrupt document", async () => {
    const renderer = createDocxtemplaterRenderer();
    await expect(renderer.inspect(new Uint8Array([1, 2, 3, 4]))).rejects.toBeInstanceOf(
      DocxInspectionError,
    );
  });
});

describe("DocxtemplaterRenderer.render", () => {
  const invoiceValues = {
    invoice_number: "12345678",
    invoice_date: "2026-09-16",
    seller_name: "示例科技有限公司",
    total_amount: "¥1234.50",
  };

  it("replaces every placeholder in the invoice fixture", async () => {
    const renderer = createDocxtemplaterRenderer();
    const output = await renderer.render({
      document: await readFixture("invoice/invoice-template.docx"),
      values: invoiceValues,
    });
    const text = await documentText(output);
    expect(text).toContain("发票号码：12345678");
    expect(text).toContain("开票日期：2026-09-16");
    expect(text).toContain("销售方：示例科技有限公司");
    expect(text).toContain("价税合计：¥1234.50");
    expect(text).not.toContain("{invoice_number}");
    expect(text).not.toContain("{total_amount}");
  });

  it("produces the same document content for the same input", async () => {
    const renderer = createDocxtemplaterRenderer();
    const template = await readFixture("invoice/invoice-template.docx");
    const first = await renderer.render({
      document: template,
      values: invoiceValues,
    });
    const second = await renderer.render({
      document: template,
      values: invoiceValues,
    });
    expect(await documentText(first)).toBe(await documentText(second));
  });

  it("renders empty strings for missing values instead of failing", async () => {
    const renderer = createDocxtemplaterRenderer();
    const output = await renderer.render({
      document: await readFixture("invoice/invoice-template.docx"),
      values: { invoice_number: "12345678" },
    });
    const text = await documentText(output);
    expect(text).toContain("发票号码：12345678");
    expect(text).toContain("开票日期：");
  });

  it("produces output that is itself a valid DOCX template", async () => {
    const renderer = createDocxtemplaterRenderer();
    const output = await renderer.render({
      document: await readFixture("invoice/invoice-template.docx"),
      values: invoiceValues,
    });
    const inspection = await renderer.inspect(output);
    expect(inspection.placeholders).toEqual([]);
  });

  it("throws a domain error when the input is not a DOCX", async () => {
    const renderer = createDocxtemplaterRenderer();
    await expect(
      renderer.render({
        document: new Uint8Array([9, 9, 9, 9]),
        values: {},
      }),
    ).rejects.toBeInstanceOf(DocxRenderError);
  });
});
