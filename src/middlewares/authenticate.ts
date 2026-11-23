import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";

import { users } from "../db/collections.js";
import { getAuth } from "../lib/auth.js";
import type { AuthUser } from "../types/express.js";
import { USER_ROLES, type UserDoc } from "../types/models.js";
import { AppError } from "../utils/app-error.js";
import { verifyAccessToken } from "../utils/jwt.js";

function toAuthUser(doc: UserDoc): AuthUser {
  return {
    _id: doc._id,
    id: doc._id.toHexString(),
    name: doc.name,
    email: doc.email,
    role: doc.role,
    plan: doc.plan === "pro" ? "pro" : "free",
    phone: doc.phone ?? null,
    image: doc.image ?? null,
  };
}

async function loadUser(id: string): Promise<AuthUser | null> {
  if (!ObjectId.isValid(id)) {
    return null;
  }

  const doc = await users().findOne({ _id: new ObjectId(id) });

  if (!doc || !USER_ROLES.includes(doc.role)) {
    return null;
  }

  return toAuthUser(doc);
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && token ? token.trim() : null;
}

/**
 * Resolves the Better Auth session from the request cookies. Used to issue
 * JWTs and as a fallback for cookie-only clients (tests, server-to-server).
 */
export async function resolveSessionUser(req: Request): Promise<AuthUser | null> {
  const session = await getAuth().api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session?.user?.id) {
    return null;
  }

  const user = await loadUser(session.user.id);
  if (user) {
    req.sessionId = session.session.id;
  }
  return user;
}

/**
 * Resolves the request user. A `Authorization: Bearer <jwt>` header is
 * verified first; role and plan are always re-read from the database so a
 * token can never grant more than the stored account allows.
 */
async function resolveUser(req: Request): Promise<AuthUser | null> {
  const token = readBearerToken(req);

  if (token) {
    const payload = verifyAccessToken(token);
    if (!payload) {
      throw AppError.unauthorized("Your access token is invalid or has expired. Please sign in again.");
    }
    return loadUser(payload.sub);
  }

  return resolveSessionUser(req);
}

/**
 * verifyToken — rejects the request unless it carries a valid JWT (or a
 * valid Better Auth session cookie) for an existing user.
 */
export async function verifyToken(req: Request, _res: Response, next: NextFunction) {
  const user = await resolveUser(req);

  if (!user) {
    throw AppError.unauthorized("Your session is missing or has expired. Please sign in.");
  }

  req.user = user;
  next();
}

/** Backwards-compatible alias. */
export const authenticate = verifyToken;

/** Attaches the user when valid credentials exist, but never rejects the request. */
export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await resolveUser(req);
    if (user) {
      req.user = user;
    }
  } catch {
    // Public endpoints keep working if credential lookup fails.
  }

  next();
}

export function requireUser(req: Request): AuthUser {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  return req.user;
}
