export interface AppErrorDto {
  code: string;
  message: string;
  details?: unknown;
}

export interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }

  toDto(): AppErrorDto {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details })
    };
  }
}

export class TemplateNotFoundError extends AppError {
  constructor(templateId: string, options: AppErrorOptions = {}) {
    super('template_not_found', `Template "${templateId}" was not found.`, options);
  }
}

export class InvalidTemplateSchemaError extends AppError {
  constructor(templateId: string, issues: unknown, options: AppErrorOptions = {}) {
    super(
      'invalid_template_schema',
      `Template "${templateId}" has an invalid configuration schema.`,
      { details: issues, ...options }
    );
  }
}

export class UnsupportedSchemaVersionError extends AppError {
  constructor(kind: string, found: unknown, supported: number, options: AppErrorOptions = {}) {
    super(
      'unsupported_schema_version',
      `${kind} uses schema version ${String(found)}, but this application only supports version ${supported}.`,
      options
    );
  }
}

export class ValidationError extends AppError {
  constructor(message: string, issues: unknown, options: AppErrorOptions = {}) {
    super('validation_failed', message, { details: issues, ...options });
  }
}

export class RunNotFoundError extends AppError {
  constructor(runId: string, options: AppErrorOptions = {}) {
    super('run_not_found', `Run "${runId}" was not found.`, options);
  }
}

export function toAppErrorDto(error: unknown): AppErrorDto {
  if (error instanceof AppError) {
    return error.toDto();
  }
  if (error instanceof Error) {
    return {
      code: 'internal_error',
      message: error.message
    };
  }
  return {
    code: 'internal_error',
    message: 'An unexpected error occurred.'
  };
}
