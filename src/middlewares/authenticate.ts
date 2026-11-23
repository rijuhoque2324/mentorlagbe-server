import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { ObjectId } from "mongodb";

import { users } from "../db/collections.js";
import { getAuth } from "../lib/auth.js";
import type { AuthUser } from "../types/express.js";
import { USER_ROLES, type UserDoc } from "../types/models.js";
import { AppError } from "../utils/app-error.js";

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

/**
 * Resolves the Better Auth session from the request cookies, then loads the
 * business user record so role and plan always come from the database (never
 * from the client or a stale token).
 */
async function resolveUser(req: Request): Promise<AuthUser | null> {
  const session = await getAuth().api.getSession({
    headers: fromNodeHeaders(req.headers),
  });

  if (!session?.user?.id || !ObjectId.isValid(session.user.id)) {
    return null;
  }

  const doc = await users().findOne({ _id: new ObjectId(session.user.id) });

  if (!doc || !USER_ROLES.includes(doc.role)) {
    return null;
  }

  req.sessionId = session.session.id;
  return toAuthUser(doc);
}

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const user = await resolveUser(req);

  if (!user) {
    throw AppError.unauthorized("Your session is missing or has expired. Please sign in.");
  }

  req.user = user;
  next();
}

/** Attaches the user when a valid session exists, but never rejects the request. */
export async function optionalAuthenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await resolveUser(req);
    if (user) {
      req.user = user;
    }
  } catch {
    // Public endpoints keep working if session lookup fails.
  }

  next();
}

export function requireUser(req: Request): AuthUser {
  if (!req.user) {
    throw AppError.unauthorized();
  }

  return req.user;
}
