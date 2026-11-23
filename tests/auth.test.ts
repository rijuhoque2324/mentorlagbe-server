import { ObjectId } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_ORIGIN, setupTestApp, signUp, type TestContext } from "./helpers/setup.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx?.close();
});

describe("registration", () => {
  it("registers a student on the free plan and links the business profile", async () => {
    const agent = request.agent(ctx.app);
    const res = await agent.post("/api/auth/sign-up/email").set("Origin", CLIENT_ORIGIN).send({
      name: "Ayesha Rahman",
      email: "Ayesha@Example.com",
      password: "Password123!",
      role: "student",
    });

    expect(res.status).toBe(200);
    const me = await agent.get("/api/v1/users/me");
    expect(me.status).toBe(200);
    expect(me.body.success).toBe(true);
    expect(me.body.data).toMatchObject({ role: "student", plan: "free", email: "ayesha@example.com" });
    expect(me.body.data).not.toHaveProperty("password");

    const doc = await ctx.db.collection("users").findOne({ _id: new ObjectId(me.body.data.id) });
    expect(doc?.plan).toBe("free");
  });

  it("registers a tutor", async () => {
    const tutor = await signUp(ctx, "tutor");
    const me = await tutor.agent.get("/api/v1/users/me");
    expect(me.body.data.role).toBe("tutor");
  });

  it("rejects public admin registration", async () => {
    const res = await request(ctx.app).post("/api/auth/sign-up/email").set("Origin", CLIENT_ORIGIN).send({
      name: "Mallory",
      email: "mallory@example.com",
      password: "Password123!",
      role: "admin",
    });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await ctx.db.collection("users").findOne({ email: "mallory@example.com" })).toBeNull();
  });

  it("ignores or rejects a client-supplied plan", async () => {
    const res = await request(ctx.app).post("/api/auth/sign-up/email").set("Origin", CLIENT_ORIGIN).send({
      name: "Plan Hacker",
      email: "planhacker@example.com",
      password: "Password123!",
      role: "student",
      plan: "pro",
    });

    const doc = await ctx.db.collection("users").findOne({ email: "planhacker@example.com" });
    if (res.status === 200) {
      expect(doc?.plan).toBe("free");
    } else {
      expect(doc).toBeNull();
    }
  });

  it("rejects duplicate emails", async () => {
    const body = { name: "Dup User", email: "dup@example.com", password: "Password123!", role: "student" };
    const first = await request(ctx.app).post("/api/auth/sign-up/email").set("Origin", CLIENT_ORIGIN).send(body);
    const second = await request(ctx.app).post("/api/auth/sign-up/email").set("Origin", CLIENT_ORIGIN).send(body);
    expect(first.status).toBe(200);
    expect(second.status).toBeGreaterThanOrEqual(400);
    expect(await ctx.db.collection("users").countDocuments({ email: "dup@example.com" })).toBe(1);
  });
});

describe("session verification", () => {
  it("returns 401 without a session", async () => {
    const res = await request(ctx.app).get("/api/v1/users/me");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: "UNAUTHENTICATED" });
  });

  it("returns 401 for a forged session cookie", async () => {
    const res = await request(ctx.app)
      .get("/api/v1/users/me")
      .set("Cookie", "better-auth.session_token=forged.token-value");
    expect(res.status).toBe(401);
  });

  it("returns 401 after the session is revoked (sign-out)", async () => {
    const student = await signUp(ctx, "student");
    expect((await student.agent.get("/api/v1/users/me")).status).toBe(200);
    await student.agent.post("/api/auth/sign-out").set("Origin", CLIENT_ORIGIN).send({});
    expect((await student.agent.get("/api/v1/users/me")).status).toBe(401);
  });

  it("returns 401 for an expired session", async () => {
    const student = await signUp(ctx, "student");
    await ctx.db
      .collection("sessions")
      .updateMany({ userId: new ObjectId(student.id) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await student.agent.get("/api/v1/users/me")).status).toBe(401);
  });

  it("signs in with email and password", async () => {
    const student = await signUp(ctx, "student");
    const agent = request.agent(ctx.app);
    const res = await agent
      .post("/api/auth/sign-in/email")
      .set("Origin", CLIENT_ORIGIN)
      .send({ email: student.email, password: "Password123!" });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("token");
    expect(String(res.headers["set-cookie"])).toMatch(/HttpOnly/i);
    expect((await agent.get("/api/v1/users/me")).status).toBe(200);

    const session = await agent.get("/api/auth/get-session").set("Origin", CLIENT_ORIGIN);
    expect(session.status).toBe(200);
    expect(session.body.user.email).toBe(student.email);
    expect(session.body.user.role).toBe("student");
    expect(session.body.session).not.toHaveProperty("token");

    const bad = await request(ctx.app)
      .post("/api/auth/sign-in/email")
      .set("Origin", CLIENT_ORIGIN)
      .send({ email: student.email, password: "wrong-password" });
    expect(bad.status).toBe(401);
  });
});

describe("profile updates", () => {
  it("updates allowed fields only", async () => {
    const student = await signUp(ctx, "student");
    const res = await student.agent.patch("/api/v1/users/me").send({ phone: "+8801711000000", location: "Dhaka" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ phone: "+8801711000000", location: "Dhaka", profileCompleted: true });
  });

  it("refuses role or plan changes through the profile endpoint", async () => {
    const student = await signUp(ctx, "student");
    const res = await student.agent.patch("/api/v1/users/me").send({ role: "admin", plan: "pro" });
    expect(res.status).toBe(400);
    const doc = await ctx.db.collection("users").findOne({ _id: new ObjectId(student.id) });
    expect(doc).toMatchObject({ role: "student", plan: "free" });
  });

  it("has Better Auth's generic update-user endpoint disabled", async () => {
    const student = await signUp(ctx, "student");
    await student.agent.post("/api/auth/update-user").set("Origin", CLIENT_ORIGIN).send({ role: "admin" });
    const doc = await ctx.db.collection("users").findOne({ _id: new ObjectId(student.id) });
    expect(doc?.role).toBe("student");
  });
});
