import { describe, expect, it } from "vitest";
import {
  AppError,
  InvalidTemplateSchemaError,
  TemplateNotFoundError,
  toAppErrorDto,
  UnsupportedSchemaVersionError,
  ValidationError,
} from "./errors.ts";

describe("domain errors", () => {
  it("exposes stable codes and details", () => {
    const error = new ValidationError("bad input", { issues: [1, 2] });
    expect(error.code).toBe("validation_failed");
    expect(error.details).toEqual({ issues: [1, 2] });
    expect(error.toDto()).toEqual({
      code: "validation_failed",
      message: "bad input",
      details: { issues: [1, 2] },
    });
  });

  it("omits details when absent", () => {
    const error = new TemplateNotFoundError("invoice-cn");
    expect(error.toDto()).toEqual({
      code: "template_not_found",
      message: 'Template "invoice-cn" was not found.',
    });
  });

  it("serializes unknown errors into a safe DTO", () => {
    expect(toAppErrorDto(new Error("boom"))).toEqual({
      code: "internal_error",
      message: "boom",
    });
    expect(toAppErrorDto("weird")).toEqual({
      code: "internal_error",
      message: "An unexpected error occurred.",
    });
  });

  it("keeps the error class name for logs", () => {
    const error = new UnsupportedSchemaVersionError("template.yaml", 2, 1);
    expect(error.name).toBe("UnsupportedSchemaVersionError");
    expect(error.code).toBe("unsupported_schema_version");
  });

  it("has AppError as the base of all domain errors", () => {
    expect(new InvalidTemplateSchemaError("x", [])).toBeInstanceOf(AppError);
  });
});
