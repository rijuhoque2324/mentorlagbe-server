import { ObjectId } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApprovedTuition, setupTestApp, signUp, type TestContext, type TestUser } from "./helpers/setup.js";

let ctx: TestContext;
let admin: TestUser;

beforeAll(async () => {
  ctx = await setupTestApp();
  admin = await signUp(ctx, "admin");
});

afterAll(async () => {
  await ctx?.close();
});

describe("admin access", () => {
  it("rejects anonymous, student and tutor callers", async () => {
    const student = await signUp(ctx, "student");
    const tutor = await signUp(ctx, "tutor");
    for (const path of ["/api/v1/admin/dashboard", "/api/v1/admin/users", "/api/v1/admin/tuitions", "/api/v1/admin/payments"]) {
      expect((await request(ctx.app).get(path)).status).toBe(401);
      expect((await student.agent.get(path)).status).toBe(403);
      expect((await tutor.agent.get(path)).status).toBe(403);
    }
  });

  it("returns dashboard stats on /dashboard and /stats", async () => {
    const tutor = await signUp(ctx, "tutor");
    await createApprovedTuition(ctx, tutor);
    for (const path of ["/api/v1/admin/dashboard", "/api/v1/admin/stats"]) {
      const res = await admin.agent.get(path);
      expect(res.status).toBe(200);
      expect(res.body.data.users.admins).toBeGreaterThanOrEqual(1);
      expect(res.body.data.tuitions.approved).toBeGreaterThanOrEqual(1);
      expect(res.body.data.transactions).toHaveProperty("revenue");
    }
  });

  it("lists and searches users without sensitive fields", async () => {
    const target = await signUp(ctx, "student", { name: "Searchable Person" });
    const res = await admin.agent.get("/api/v1/admin/users").query({ search: "Searchable", role: "student" });
    expect(res.status).toBe(200);
    expect(res.body.data.map((u: { id: string }) => u.id)).toContain(target.id);
    for (const user of res.body.data) {
      expect(user).not.toHaveProperty("password");
    }

    const detail = await admin.agent.get(`/api/v1/admin/users/${target.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.stats).toBeDefined();
  });
});

describe("role management", () => {
  it("changes a role and records it", async () => {
    const target = await signUp(ctx, "student");
    const res = await admin.agent.patch(`/api/v1/admin/users/${target.id}/role`).send({ role: "tutor" });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe("tutor");
    expect(res.body.data.roleHistory[0]).toMatchObject({ from: "student", to: "tutor", changedBy: admin.id });

    // The new role takes effect immediately on the next request.
    expect((await target.agent.get("/api/v1/tuitions/mine")).status).toBe(200);
  });

  it("supports the client's PATCH /admin/users/:id alias", async () => {
    const target = await signUp(ctx, "tutor");
    const res = await admin.agent.patch(`/api/v1/admin/users/${target.id}`).send({ role: "student" });
    expect(res.status).toBe(200);
  });

  it("prevents self role changes", async () => {
    const res = await admin.agent.patch(`/api/v1/admin/users/${admin.id}/role`).send({ role: "student" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SELF_ROLE_CHANGE");
  });

  it("never leaves the platform without an admin, even when two admins demote each other concurrently", async () => {
    const second = await signUp(ctx, "admin");
    // Leave exactly two admins.
    await ctx.db
      .collection("users")
      .updateMany(
        { role: "admin", _id: { $nin: [new ObjectId(admin.id), new ObjectId(second.id)] } },
        { $set: { role: "student" } },
      );

    await Promise.all([
      admin.agent.patch(`/api/v1/admin/users/${second.id}/role`).send({ role: "student" }),
      second.agent.patch(`/api/v1/admin/users/${admin.id}/role`).send({ role: "student" }),
    ]);

    expect(await ctx.db.collection("users").countDocuments({ role: "admin" })).toBeGreaterThanOrEqual(1);

    // Restore the primary admin for later tests.
    await ctx.db.collection("users").updateOne({ _id: new ObjectId(admin.id) }, { $set: { role: "admin" } });
  });

  it("rejects invalid roles", async () => {
    const target = await signUp(ctx, "student");
    const res = await admin.agent.patch(`/api/v1/admin/users/${target.id}/role`).send({ role: "superuser" });
    expect(res.status).toBe(400);
  });
});
