import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApprovedTuition, setupTestApp, signUp, type TestContext } from "./helpers/setup.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx.close();
});

describe("GET /api/v1/stats/public", () => {
  it("returns counts and popular subjects without authentication", async () => {
    const tutor = await signUp(ctx, "tutor");
    await signUp(ctx, "student");
    await createApprovedTuition(ctx, tutor, { subject: "Physics" });

    const res = await request(ctx.app).get("/api/v1/stats/public");

    expect(res.status).toBe(200);
    expect(res.body.data.tutors).toBeGreaterThanOrEqual(1);
    expect(res.body.data.students).toBeGreaterThanOrEqual(1);
    expect(res.body.data.liveTuitions).toBe(1);
    expect(res.body.data.subjects).toEqual([{ subject: "Physics", count: 1 }]);
    expect(JSON.stringify(res.body)).not.toContain("@example.com");
  });
});
