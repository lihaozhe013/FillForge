import { AppError, type AppErrorOptions } from "@docufill/core";

export class DocxInspectionError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("docx_inspection_failed", message, options);
  }
}

export class DocxRenderError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("docx_render_failed", message, options);
  }
}

export type { AppErrorOptions };
