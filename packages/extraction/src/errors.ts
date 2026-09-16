import { AppError, type AppErrorOptions } from "@docufill/core";

export class ExtractionParseError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("extraction_parse_failed", message, options);
  }
}
