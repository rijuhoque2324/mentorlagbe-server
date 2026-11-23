import type { NextFunction, Request, Response } from "express";
import type { z } from "zod";

interface Schemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/**
 * Parses request input with Zod. Parsed (and stripped) values are stored on
 * `req.validated`; handlers must read from there rather than from raw
 * `req.body` / `req.query`, which protects against mass assignment and
 * operator injection (unknown keys are dropped by `z.object`).
 */
export function validate(schemas: Schemas) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.validated ??= {};

    if (schemas.params) {
      req.validated.params = schemas.params.parse(req.params);
    }

    if (schemas.query) {
      req.validated.query = schemas.query.parse(req.query);
    }

    if (schemas.body) {
      req.validated.body = schemas.body.parse(req.body ?? {});
    }

    next();
  };
}

export function body<T>(req: Request): T {
  return req.validated.body as T;
}

export function query<T>(req: Request): T {
  return req.validated.query as T;
}

export function params<T>(req: Request): T {
  return req.validated.params as T;
}
