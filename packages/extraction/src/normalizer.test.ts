import type { ExtractionResult, TemplateSchema } from "@docufill/schema";
import { describe, expect, it } from "vitest";
import { formatDate, normalizeExtractionResult, normalizeFieldValue } from "./normalizer.ts";
import { validateExtractionResult } from "./validator.ts";

const invoiceTemplate: TemplateSchema = {
  schema_version: 1,
  id: "invoice-cn",
  name: "中国发票",
  document: { file: "invoice-template.docx" },
  fields: {
    invoice_number: {
      label: "发票号码",
      type: "string",
      required: true,
      normalization: { trim: true, remove_spaces: true },
      validation: { regex: "^[0-9A-Za-z-]+$" },
    },
    invoice_date: {
      label: "开票日期",
      type: "date",
      required: true,
      output: { format: "YYYY-MM-DD" },
    },
    total_amount: {
      label: "价税合计",
      type: "number",
      required: true,
      validation: { minimum: 0 },
    },
    remark: {
      label: "备注",
      type: "string",
      required: false,
    },
  },
};

function extracted(
  value: unknown,
  status: "found" | "not_found" | "ambiguous" = "found",
  evidence: string | null = null,
): { value: unknown; status: "found" | "not_found" | "ambiguous"; evidence: string | null } {
  return { value, status, evidence };
}

describe("validateExtractionResult", () => {
  it("accepts a complete valid result", () => {
    const result: ExtractionResult = {
      invoice_number: extracted("12345678", "found", "发票号码：12345678"),
      invoice_date: extracted("2026-09-16", "found", "开票日期"),
      total_amount: extracted(1234.5, "found", "价税合计"),
    };
    expect(validateExtractionResult(result, invoiceTemplate)).toEqual([]);
  });

  it("flags unknown fields", () => {
    const result: ExtractionResult = {
      bogus_field: extracted("x"),
      invoice_number: extracted("12345678"),
      invoice_date: extracted("2026-09-16"),
      total_amount: extracted(1),
    };
    const issues = validateExtractionResult(result, invoiceTemplate);
    expect(issues.map((issue) => issue.code)).toContain("unknown_field");
  });

  it("flags missing required fields", () => {
    const issues = validateExtractionResult(
      { invoice_number: extracted("12345678") },
      invoiceTemplate,
    );
    const codes = issues.map((issue) => issue.code);
    expect(codes).toContain("missing_field");
    expect(issues.filter((issue) => issue.field === "invoice_number")).toEqual([]);
  });

  it("flags invalid types", () => {
    const issues = validateExtractionResult(
      {
        invoice_number: extracted(123),
        invoice_date: extracted("2026-09-16"),
        total_amount: extracted("not a number"),
      },
      invoiceTemplate,
    );
    const codes = issues.map((issue) => `${issue.field}:${issue.code}`);
    expect(codes).toContain("invoice_number:type_mismatch");
    expect(codes).toContain("total_amount:type_mismatch");
  });

  it("flags required fields reported as not_found", () => {
    const issues = validateExtractionResult(
      {
        invoice_number: extracted(null, "not_found"),
        invoice_date: extracted("2026-09-16"),
        total_amount: extracted(1),
      },
      invoiceTemplate,
    );
    expect(issues.map((issue) => issue.code)).toContain("required_not_found");
  });

  it("flags regex and minimum rule violations", () => {
    const issues = validateExtractionResult(
      {
        invoice_number: extracted("not valid!!"),
        invoice_date: extracted("2026-09-16"),
        total_amount: extracted(-50),
      },
      invoiceTemplate,
    );
    const codes = issues.map((issue) => `${issue.field}:${issue.code}`);
    expect(codes).toContain("invoice_number:rule_violation");
    expect(codes).toContain("total_amount:rule_violation");
  });

  it("allows missing optional fields", () => {
    const issues = validateExtractionResult(
      {
        invoice_number: extracted("12345678"),
        invoice_date: extracted("2026-09-16"),
        total_amount: extracted(1),
      },
      invoiceTemplate,
    );
    expect(issues).toEqual([]);
  });
});

describe("normalizeFieldValue", () => {
  it("trims and removes spaces for strings", () => {
    const field = invoiceTemplate.fields.invoice_number;
    expect(normalizeFieldValue(field, " 1234 5678 ")).toBe("12345678");
  });

  it("coerces numeric strings to numbers", () => {
    const field = invoiceTemplate.fields.total_amount;
    expect(normalizeFieldValue(field, "1234.50")).toBe(1234.5);
    expect(normalizeFieldValue(field, 12)).toBe(12);
    expect(normalizeFieldValue(field, "abc")).toBe("abc");
  });

  it("normalizes common Chinese and slash date formats", () => {
    const field = invoiceTemplate.fields.invoice_date;
    expect(normalizeFieldValue(field, "2026年09月16日")).toBe("2026-09-16");
    expect(normalizeFieldValue(field, "2026/9/6")).toBe("2026-09-06");
    expect(normalizeFieldValue(field, "2026-09-16")).toBe("2026-09-16");
    expect(normalizeFieldValue(field, "unparseable")).toBe("unparseable");
  });

  it("formats dates according to the output format", () => {
    const field = { ...invoiceTemplate.fields.invoice_date };
    expect(normalizeFieldValue(field, "2026-09-16")).toBe("2026-09-16");
    expect(
      normalizeFieldValue({ ...field, output: { format: "YYYY年MM月DD日" } }, "2026-09-16"),
    ).toBe("2026年09月16日");
  });

  it("keeps null values null", () => {
    expect(normalizeFieldValue(invoiceTemplate.fields.remark, null)).toBeNull();
  });
});

describe("formatDate", () => {
  it("applies YYYY MM DD tokens", () => {
    expect(formatDate(["2026", "09", "16"], "YYYY/MM/DD")).toBe("2026/09/16");
    expect(formatDate(["2026", "09", "16"], "YYYY年MM月DD日")).toBe("2026年09月16日");
  });
});

describe("normalizeExtractionResult", () => {
  it("builds a business record from an extraction result", () => {
    const values = normalizeExtractionResult(
      {
        invoice_number: extracted(" 1234 5678 ", "found", "发票号码"),
        invoice_date: extracted("2026年09月16日", "found", "开票日期"),
        total_amount: extracted("1234.50", "found", "价税合计"),
        unknown_field: extracted("ignored"),
        remark: extracted(null, "not_found"),
      },
      invoiceTemplate.fields,
    );
    expect(values).toEqual({
      invoice_number: "12345678",
      invoice_date: "2026-09-16",
      total_amount: 1234.5,
    });
  });
});
