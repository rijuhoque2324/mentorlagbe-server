export interface FieldError {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string | undefined;
  readonly errors: FieldError[] | null;

  constructor(
    statusCode: number,
    message: string,
    options: { code?: string; errors?: FieldError[] | null; cause?: unknown } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = options.code;
    this.errors = options.errors ?? null;
  }

  static badRequest(message = "Invalid request", options?: { code?: string; errors?: FieldError[] }) {
    return new AppError(400, message, options);
  }

  static unauthorized(message = "Authentication required") {
    return new AppError(401, message, { code: "UNAUTHENTICATED" });
  }

  static forbidden(message = "You are not authorized to perform this action", code = "FORBIDDEN") {
    return new AppError(403, message, { code });
  }

  static notFound(message = "Resource not found") {
    return new AppError(404, message, { code: "NOT_FOUND" });
  }

  static conflict(message: string, code = "CONFLICT") {
    return new AppError(409, message, { code });
  }

  static serviceUnavailable(message: string) {
    return new AppError(503, message, { code: "SERVICE_UNAVAILABLE" });
  }

  static badGateway(message: string) {
    return new AppError(502, message, { code: "UPSTREAM_ERROR" });
  }
}

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
