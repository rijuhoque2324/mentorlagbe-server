import { randomBytes } from "node:crypto";

import type { Db, ObjectId } from "mongodb";

import { connectDatabase, disconnectDatabase } from "../src/config/db.js";
import { users } from "../src/db/collections.js";
import { ensureIndexes } from "../src/db/collections.js";
import { initAuth, type Auth } from "../src/lib/auth.js";
import type { PlanTier, UserRole } from "../src/types/models.js";

export async function bootstrap(): Promise<{ db: Db; auth: Auth; close: () => Promise<void> }> {
  const db = await connectDatabase();
  await ensureIndexes(db);
  const auth = initAuth(db);
  return { db, auth, close: disconnectDatabase };
}

export function generatePassword(): string {
  return `${randomBytes(9).toString("base64url")}A1!`;
}

export function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/**
 * Creates a user through Better Auth (so the password is hashed and the
 * credential account is created exactly as on sign-up), then applies the
 * trusted role/plan directly. Returns the existing user if the email exists.
 */
export async function ensureUser(
  auth: Auth,
  input: { name: string; email: string; password: string; role: UserRole; plan?: PlanTier; phone?: string },
): Promise<{ id: ObjectId; created: boolean }> {
  const email = input.email.trim().toLowerCase();
  const existing = await users().findOne({ email });

  if (existing) {
    return { id: existing._id, created: false };
  }

  await auth.api.signUpEmail({
    body: {
      name: input.name,
      email,
      password: input.password,
      role: input.role === "admin" ? "student" : input.role,
      ...(input.phone ? { phone: input.phone } : {}),
    },
  });

  const created = await users().findOne({ email });
  if (!created) {
    throw new Error(`Failed to create user ${email}`);
  }

  const now = new Date();
  await users().updateOne(
    { _id: created._id },
    {
      $set: {
        role: input.role,
        plan: input.plan ?? "free",
        planActivatedAt: input.plan === "pro" ? now : null,
        emailVerified: true,
        profileCompleted: Boolean(input.phone),
        updatedAt: now,
      },
    },
  );

  return { id: created._id, created: true };
}
