import { toNodeHandler } from "better-auth/node";
import { Router, type Express } from "express";

import type { Auth } from "../../lib/auth.js";
import { requireUser, resolveSessionUser, verifyToken } from "../../middlewares/authenticate.js";
import { AppError } from "../../utils/app-error.js";
import { signAccessToken } from "../../utils/jwt.js";
import { authLimiter } from "../../middlewares/rate-limit.js";
import { sendSuccess } from "../../utils/response.js";
import { getUserById } from "../users/users.service.js";
import { serializeUser } from "../users/users.serializer.js";

/**
 * Better Auth handler, mounted at /api/auth/* (outside the versioned API, and
 * before express.json(), because Better Auth reads the raw request itself).
 *
 * Endpoints provided by Better Auth include:
 *   POST /api/auth/sign-up/email   { name, email, password, role, phone? }
 *   POST /api/auth/sign-in/email   { email, password, rememberMe? }
 *   POST /api/auth/sign-out
 *   GET  /api/auth/get-session
 *   POST /api/auth/change-password
 */
export function mountBetterAuth(app: Express, auth: Auth) {
  // Registered on the app itself (not a sub-router) so Better Auth sees the
  // full, un-rewritten request URL.
  app.use(["/api/auth/sign-in", "/api/auth/sign-up"], authLimiter);
  app.all("/api/auth/*splat", toNodeHandler(auth));
}

/** GET /api/v1/auth/session — convenience: the verified session's business user. */
export const authInfoRouter = Router();

authInfoRouter.get("/session", verifyToken, async (req, res) => {
  const user = requireUser(req);
  sendSuccess(res, { user: serializeUser(await getUserById(user._id)) }, "Session is valid");
});

/**
 * POST /api/v1/auth/token — exchanges a valid Better Auth session cookie for a
 * short-lived JWT. The client sends it as `Authorization: Bearer <token>` on
 * every protected request, where `verifyToken` validates it.
 */
authInfoRouter.post("/token", async (req, res) => {
  const user = await resolveSessionUser(req);

  if (!user) {
    throw AppError.unauthorized("Sign in to receive an access token.");
  }

  res.setHeader("Cache-Control", "no-store");
  const { token, expiresIn } = signAccessToken({ sub: user.id, email: user.email, role: user.role });
  sendSuccess(res, { token, tokenType: "Bearer", expiresIn }, "Access token issued");
});
