import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { ZodError } from "zod";

import { env } from "../config/env.js";
import { AppError, isDuplicateKeyError, type FieldError } from "../utils/app-error.js";
import { logger } from "../utils/logger.js";

interface ErrorBody {
  success: false;
  message: string;
  code?: string;
  errors: FieldError[] | null;
  requestId?: string;
  stack?: string;
}

function fromZod(error: ZodError): AppError {
  const errors = error.issues.map((issue) => ({
    field: issue.path.join(".") || "input",
    message: issue.message,
  }));

  return new AppError(400, errors[0]?.message ?? "Invalid request", {
    code: "VALIDATION_ERROR",
    errors,
  });
}

function normalize(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return fromZod(error);
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return new AppError(413, "Image is too large", { code: "FILE_TOO_LARGE" });
    }
    return AppError.badRequest(
      error.code === "LIMIT_UNEXPECTED_FILE" ? "Upload the image in the `image` field" : error.message,
      { code: "UPLOAD_ERROR" },
    );
  }

  if (isDuplicateKeyError(error)) {
    return AppError.conflict("A record with the same unique value already exists", "DUPLICATE");
  }

  // body-parser errors
  if (typeof error === "object" && error !== null && "type" in error) {
    const type = (error as { type?: string }).type;
    if (type === "entity.parse.failed") {
      return AppError.badRequest("Malformed JSON body", { code: "MALFORMED_JSON" });
    }
    if (type === "entity.too.large") {
      return new AppError(413, "Request body is too large", { code: "PAYLOAD_TOO_LARGE" });
    }
  }

  return new AppError(500, "Something went wrong on our side. Please try again.", {
    code: "INTERNAL_ERROR",
    cause: error,
  });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const appError = normalize(error);

  const unexpected = !(error instanceof AppError) && appError.statusCode >= 500;

  if (error instanceof AppError && appError.statusCode >= 500) {
    logger.warn("Request failed", {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: appError.statusCode,
      code: appError.code,
      message: appError.message,
    });
  } else if (unexpected) {
    logger.error("Unhandled error", {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
    });
  }

  if (res.headersSent) {
    return;
  }

  const responseBody: ErrorBody = {
    success: false,
    message: appError.message,
    errors: appError.errors,
    requestId: req.requestId,
  };

  if (appError.code) {
    responseBody.code = appError.code;
  }

  if (env.NODE_ENV === "development" && unexpected && error instanceof Error) {
    responseBody.stack = error.stack;
  }

  res.status(appError.statusCode).json(responseBody);
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.path}`,
    code: "ROUTE_NOT_FOUND",
    errors: null,
    requestId: req.requestId,
  });
}
