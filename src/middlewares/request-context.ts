import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const INCOMING_ID = /^[A-Za-z0-9._-]{8,100}$/;

/** Assigns a correlation id to each request and logs the outcome. */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = req.get("x-request-id");
  req.requestId = incoming && INCOMING_ID.test(incoming) ? incoming : randomUUID();
  req.validated = {};
  res.setHeader("X-Request-Id", req.requestId);

  const startedAt = process.hrtime.bigint();
  const shouldLog = env.LOG_REQUESTS ?? !env.isTest;

  if (shouldLog) {
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info("request", {
        requestId: req.requestId,
        method: req.method,
        path: req.originalUrl.split("?")[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs),
        userId: req.user?.id,
      });
    });
  }

  next();
}
