import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_ORIGIN, setupTestApp, signUp, type TestContext, validTuition } from "./helpers/setup.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx.close();
});

async function issueToken(agent: ReturnType<typeof request.agent>): Promise<string> {
  const res = await agent.post("/api/v1/auth/token").set("Origin", CLIENT_ORIGIN);
  expect(res.status).toBe(200);
  expect(res.body.data.tokenType).toBe("Bearer");
  return res.body.data.token as string;
}

describe("JWT access tokens", () => {
  it("refuses to issue a token without a session", async () => {
    const res = await request(ctx.app).post("/api/v1/auth/token");
    expect(res.status).toBe(401);
  });

  it("issues a token that authenticates protected routes without cookies", async () => {
    const tutor = await signUp(ctx, "tutor");
    const token = await issueToken(tutor.agent);

    const me = await request(ctx.app).get("/api/v1/users/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user?.email ?? me.body.data.email).toBe(tutor.email);
  });

  it("rejects tampered or garbage tokens with 401", async () => {
    const res = await request(ctx.app).get("/api/v1/users/me").set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("verifyTutor blocks a student token from tutor-only routes", async () => {
    const student = await signUp(ctx, "student");
    const token = await issueToken(student.agent);

    const res = await request(ctx.app)
      .post("/api/v1/tuitions")
      .set("Authorization", `Bearer ${token}`)
      .send(validTuition());
    expect(res.status).toBe(403);
  });

  it("verifyAdmin blocks non-admin tokens and allows admins", async () => {
    const tutor = await signUp(ctx, "tutor");
    const tutorToken = await issueToken(tutor.agent);
    const denied = await request(ctx.app).get("/api/v1/admin/stats").set("Authorization", `Bearer ${tutorToken}`);
    expect(denied.status).toBe(403);

    const admin = await signUp(ctx, "admin");
    const adminToken = await issueToken(admin.agent);
    const allowed = await request(ctx.app).get("/api/v1/admin/users").set("Authorization", `Bearer ${adminToken}`);
    expect(allowed.status).toBe(200);
  });
});
