import type { NextFunction, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";

import { env } from "../config/env.js";

const passThrough = (_req: Request, _res: Response, next: NextFunction) => next();

function limiter(windowMs: number, limit: number, message: string) {
  if (env.isTest) {
    return passThrough;
  }

  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message,
        code: "RATE_LIMITED",
        errors: null,
        requestId: req.requestId,
      });
    },
  });
}

/** General API ceiling per IP. */
export const apiLimiter = limiter(15 * 60 * 1000, 600, "Too many requests. Please slow down.");

/** Sign-in / sign-up brute-force protection (in addition to Better Auth's own limiter). */
export const authLimiter = limiter(15 * 60 * 1000, 30, "Too many authentication attempts. Try again later.");

/** Checkout creation and uploads hit paid third-party APIs. */
export const sensitiveLimiter = limiter(15 * 60 * 1000, 30, "Too many requests for this action. Try again later.");
