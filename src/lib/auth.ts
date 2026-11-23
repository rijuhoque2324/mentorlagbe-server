import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { APIError, createAuthMiddleware } from "better-auth/api";
import type { Db } from "mongodb";
import { z } from "zod";

import { env } from "../config/env.js";

/**
 * Authentication architecture
 * ---------------------------
 * Better Auth is the only authentication authority. It is mounted on the
 * Express app at `/api/auth/*` and issues an HTTP-only session cookie.
 *
 * The Express API verifies every protected request by calling
 * `auth.api.getSession({ headers })`, which validates the signed session
 * cookie against the `sessions` collection. No parallel JWT system exists.
 *
 * Better Auth's user model is stored in the business `users` collection
 * (`usePlural: true`), so there is exactly one user record per person. The
 * `role`/`plan` business fields are Better Auth "additional fields":
 *   - `role` may be supplied at sign-up but only as "student" or "tutor".
 *   - `plan` can never be supplied by a client (`input: false`).
 * Better Auth's generic `/update-user` endpoint is disabled so role/plan can
 * only change through the dedicated, authorised business endpoints.
 */

const signUpRoleSchema = z.enum(["student", "tutor"], {
  error: "Role must be either student or tutor",
});

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{6,20}$/, "Enter a valid phone number");

const TOKEN_BEARING_PATHS = new Set(["/sign-in/email", "/sign-up/email", "/get-session"]);

function stripTokens(body: Record<string, unknown>): Record<string, unknown> {
  const { token: _token, ...rest } = body;
  const session = rest.session;
  if (session && typeof session === "object") {
    const { token: _sessionToken, ...safeSession } = session as Record<string, unknown>;
    rest.session = safeSession;
  }
  return rest;
}

export function createAuth(db: Db) {
  return betterAuth({
    appName: "MentorLagbe",
    baseURL: env.BETTER_AUTH_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.CLIENT_ORIGINS,

    database: mongodbAdapter(db, {
      usePlural: true,
      // Transactions require a replica set; MongoDB Atlas supports them, but
      // local standalone servers do not. Business writes do not rely on them.
      transaction: false,
    }),

    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },

    user: {
      additionalFields: {
        role: {
          type: "string",
          required: false,
          defaultValue: "student",
          input: true,
          validator: { input: signUpRoleSchema },
        },
        plan: {
          type: "string",
          required: false,
          defaultValue: "free",
          input: false,
        },
        phone: {
          type: "string",
          required: false,
          input: true,
          validator: { input: phoneSchema },
        },
        bio: { type: "string", required: false, input: false },
        location: { type: "string", required: false, input: false },
        profileCompleted: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
        },
      },
    },

    // Profile, role and plan changes go through /api/v1 business endpoints.
    disabledPaths: ["/update-user", "/delete-user", "/change-email"],

    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const requestedRole = user.role ?? "student";

            // Any request arriving through an HTTP endpoint is public sign-up:
            // only student/tutor are allowed. Admins are provisioned by script.
            if (context && requestedRole !== "student" && requestedRole !== "tutor") {
              throw new APIError("BAD_REQUEST", {
                message: "Public registration is only available for students and tutors",
              });
            }

            if (!context && !["student", "tutor", "admin"].includes(String(requestedRole))) {
              throw new APIError("BAD_REQUEST", { message: "Invalid role" });
            }

            return {
              data: {
                ...user,
                email: String(user.email).trim().toLowerCase(),
                role: requestedRole,
                plan: "free",
                phone: typeof user.phone === "string" ? user.phone.trim() : null,
                profileCompleted: Boolean(user.name && user.phone),
              },
            };
          },
        },
      },
    },

    hooks: {
      // The session lives in an HTTP-only cookie. Strip the raw session token
      // from JSON bodies so page scripts can never read it.
      after: createAuthMiddleware(async (ctx) => {
        if (!TOKEN_BEARING_PATHS.has(ctx.path)) return;
        const returned = ctx.context.returned;
        if (!returned || typeof returned !== "object" || returned instanceof Response || returned instanceof Error) {
          return;
        }
        return ctx.json(stripTokens(returned as Record<string, unknown>));
      }),
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // refresh expiry daily
    },

    rateLimit: {
      enabled: env.isProduction,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
      },
    },

    advanced: {
      useSecureCookies: env.isProduction,
      // Production client and API are usually on different sites (e.g. Vercel
      // + Render), which requires SameSite=None; Secure for credentialed CORS.
      defaultCookieAttributes: env.isProduction
        ? { sameSite: "none", secure: true, httpOnly: true }
        : { sameSite: "lax", secure: false, httpOnly: true },
    },

    telemetry: { enabled: false },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let authInstance: Auth | null = null;

export function initAuth(db: Db): Auth {
  authInstance = createAuth(db);
  return authInstance;
}

export function getAuth(): Auth {
  if (!authInstance) {
    throw new Error("Auth is not initialised. Call initAuth(db) first.");
  }

  return authInstance;
}
