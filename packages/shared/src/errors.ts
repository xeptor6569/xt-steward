/**
 * Application error with a stable machine-readable code and an HTTP status.
 * The API serializes these into structured error responses:
 * `{ error: { code, message, details? } }`.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: unknown;

  constructor(
    code: string,
    message: string,
    options: { statusCode?: number; details?: unknown; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.statusCode = options.statusCode ?? 500;
    this.details = options.details;
  }

  static notFound(resource: string): AppError {
    return new AppError("not_found", `${resource} not found`, { statusCode: 404 });
  }

  static unauthorized(message = "Authentication required"): AppError {
    return new AppError("unauthorized", message, { statusCode: 401 });
  }

  static forbidden(message = "Not allowed"): AppError {
    return new AppError("forbidden", message, { statusCode: 403 });
  }

  static conflict(code: string, message: string): AppError {
    return new AppError(code, message, { statusCode: 409 });
  }

  static badRequest(code: string, message: string, details?: unknown): AppError {
    return new AppError(code, message, { statusCode: 400, details });
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
