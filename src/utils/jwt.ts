import jwt, { type SignOptions } from "jsonwebtoken";

import { env } from "../config/env.js";
import type { UserRole } from "../types/models.js";

const ISSUER = "mentorlagbe-api";
const AUDIENCE = "mentorlagbe-client";

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

/** Signs a short-lived HS256 access token for the given user. */
export function signAccessToken(payload: AccessTokenPayload): { token: string; expiresIn: string } {
  const token = jwt.sign({ email: payload.email, role: payload.role }, env.JWT_SIGNING_SECRET, {
    algorithm: "HS256",
    subject: payload.sub,
    issuer: ISSUER,
    audience: AUDIENCE,
    expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"],
  });

  return { token, expiresIn: env.JWT_EXPIRES_IN };
}

/** Verifies signature, expiry, issuer and audience. Returns null on any failure. */
export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SIGNING_SECRET, {
      algorithms: ["HS256"],
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (typeof decoded === "string" || typeof decoded.sub !== "string") {
      return null;
    }

    return {
      sub: decoded.sub,
      email: String(decoded.email ?? ""),
      role: decoded.role as UserRole,
    };
  } catch {
    return null;
  }
}
