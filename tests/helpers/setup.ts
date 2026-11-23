import { randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";

import { ObjectId, type Db } from "mongodb";
import request from "supertest";
import { inject } from "vitest";

export const CLIENT_ORIGIN = "http://localhost:3000";
export const WEBHOOK_SECRET = "whsec_test_mentorlagbe_secret";

export interface TestContext {
  /** A single listening HTTP server per test file (supertest reuses it). */
  app: Server;
  db: Db;
  close: () => Promise<void>;
}

/**
 * Boots the real app against the shared in-memory MongoDB (see
 * tests/global-setup.ts), using a fresh database per test file. Env vars are
 * set before the application modules are imported, because config is read at
 * import time.
 */
export async function setupTestApp(): Promise<TestContext> {
  const dbName = `mentorlagbe_test_${randomBytes(4).toString("hex")}`;

  Object.assign(process.env, {
    NODE_ENV: "test",
    MONGODB_URI: inject("mongoUri"),
    MONGODB_DB_NAME: dbName,
    BETTER_AUTH_SECRET: "test-secret-that-is-at-least-thirty-two-characters",
    BETTER_AUTH_URL: "http://localhost:5000",
    CLIENT_URL: CLIENT_ORIGIN,
    STRIPE_SECRET_KEY: "sk_test_mentorlagbe_dummy",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    STRIPE_CURRENCY: "usd",
    IMGBB_API_KEY: "imgbb_test_key",
  });

  const { connectDatabase, disconnectDatabase } = await import("../../src/config/db.js");
  const { ensureIndexes } = await import("../../src/db/collections.js");
  const { initAuth } = await import("../../src/lib/auth.js");
  const { createApp } = await import("../../src/app.js");

  const db = await connectDatabase();
  await ensureIndexes(db);
  const server = createServer(createApp(initAuth(db)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    app: server,
    db,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await db.dropDatabase().catch(() => undefined);
      await disconnectDatabase();
    },
  };
}

let counter = 0;

export interface TestUser {
  agent: ReturnType<typeof request.agent>;
  id: string;
  email: string;
  name: string;
}

/** Signs up through Better Auth and returns a cookie-carrying agent. */
export async function signUp(
  ctx: TestContext,
  role: "student" | "tutor" | "admin",
  overrides: { plan?: "free" | "pro"; phone?: string; name?: string } = {},
): Promise<TestUser> {
  counter += 1;
  const email = `${role}${counter}-${Date.now()}@example.com`;
  const name = overrides.name ?? `Test ${role} ${counter}`;
  const agent = request.agent(ctx.app);

  const res = await agent
    .post("/api/auth/sign-up/email")
    .set("Origin", CLIENT_ORIGIN)
    .send({
      name,
      email,
      password: "Password123!",
      role: role === "admin" ? "student" : role,
      ...(overrides.phone ? { phone: overrides.phone } : {}),
    });

  if (res.status !== 200) {
    throw new Error(`Sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  const id = res.body.user.id as string;
  const set: Record<string, unknown> = {};
  if (role === "admin") set.role = "admin";
  if (overrides.plan) set.plan = overrides.plan;
  if (Object.keys(set).length > 0) {
    await ctx.db.collection("users").updateOne({ _id: new ObjectId(id) }, { $set: set });
  }

  return { agent, id, email, name };
}

export const validTuition = (overrides: Record<string, unknown> = {}) => ({
  title: "HSC Physics weekly tuition",
  subject: "Physics",
  classLevel: "HSC",
  mode: "offline",
  location: "Dhanmondi, Dhaka",
  monthlyFee: 5000,
  daysPerWeek: 3,
  description: "Full syllabus coverage with weekly problem-solving sessions.",
  ...overrides,
});

/** Creates a tuition as the tutor and approves it directly in the DB. */
export async function createApprovedTuition(
  ctx: TestContext,
  tutor: TestUser,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const res = await tutor.agent.post("/api/v1/tuitions").set("Origin", CLIENT_ORIGIN).send(validTuition(overrides));
  if (res.status !== 201) {
    throw new Error(`Create tuition failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  const id = res.body.data.id as string;
  await ctx.db
    .collection("tuitions")
    .updateOne({ _id: new ObjectId(id) }, { $set: { approvalStatus: "approved", isActive: true } });
  return id;
}
