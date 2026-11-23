import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApprovedTuition, setupTestApp, signUp, validTuition, type TestContext, type TestUser } from "./helpers/setup.js";

let ctx: TestContext;
let tutor: TestUser;
let tuitionIds: string[] = [];

beforeAll(async () => {
  ctx = await setupTestApp();
  tutor = await signUp(ctx, "tutor", { plan: "pro" });
  tuitionIds = [];
  for (let i = 0; i < 7; i += 1) {
    tuitionIds.push(await createApprovedTuition(ctx, tutor, { title: `Bookmarkable tuition ${i}` }));
  }
});

afterAll(async () => {
  await ctx?.close();
});

describe("bookmarks", () => {
  it("limits free students to five bookmarks", async () => {
    const student = await signUp(ctx, "student");
    for (const id of tuitionIds.slice(0, 5)) {
      expect((await student.agent.post("/api/v1/bookmarks").send({ tuitionId: id })).status).toBe(201);
    }
    const sixth = await student.agent.post(`/api/v1/bookmarks/${tuitionIds[5]}`);
    expect(sixth.status).toBe(409);
    expect(sixth.body.code).toBe("PLAN_LIMIT_REACHED");

    const list = await student.agent.get("/api/v1/bookmarks");
    expect(list.body.data).toHaveLength(5);
    expect(list.body.meta.bookmarkLimit).toBe(5);
  });

  it("holds the limit under concurrent requests", async () => {
    const student = await signUp(ctx, "student");
    await Promise.all(tuitionIds.map((id) => student.agent.post("/api/v1/bookmarks").send({ tuitionId: id })));
    expect(await ctx.db.collection("bookmarks").countDocuments({ studentId: new ObjectId(student.id) })).toBeLessThanOrEqual(5);
  });

  it("gives Student Pro unlimited bookmarks", async () => {
    const student = await signUp(ctx, "student", { plan: "pro" });
    for (const id of tuitionIds) {
      expect((await student.agent.post("/api/v1/bookmarks").send({ tuitionId: id })).status).toBe(201);
    }
  });

  it("rejects duplicates and ineligible tuitions", async () => {
    const student = await signUp(ctx, "student");
    await student.agent.post("/api/v1/bookmarks").send({ tuitionId: tuitionIds[0] });
    const dup = await student.agent.post("/api/v1/bookmarks").send({ tuitionId: tuitionIds[0] });
    expect(dup.status).toBe(409);

    const pending = await tutor.agent.post("/api/v1/tuitions").send(validTuition());
    expect((await student.agent.post("/api/v1/bookmarks").send({ tuitionId: pending.body.data.id })).status).toBe(404);
  });

  it("removes by bookmark id or tuition id, scoped to the owner", async () => {
    const student = await signUp(ctx, "student");
    const other = await signUp(ctx, "student");
    const added = await student.agent.post("/api/v1/bookmarks").send({ tuitionId: tuitionIds[1] });
    await student.agent.post("/api/v1/bookmarks").send({ tuitionId: tuitionIds[2] });

    expect((await other.agent.delete(`/api/v1/bookmarks/${added.body.data.id}`)).status).toBe(404);
    expect((await student.agent.delete(`/api/v1/bookmarks/${added.body.data.id}`)).status).toBe(200);
    expect((await student.agent.delete(`/api/v1/bookmarks/tuition/${tuitionIds[2]}`)).status).toBe(200);
    expect((await student.agent.get("/api/v1/bookmarks")).body.data).toHaveLength(0);
  });

  it("marks bookmarked tuitions in public listings for the student", async () => {
    const student = await signUp(ctx, "student");
    await student.agent.post("/api/v1/bookmarks").send({ tuitionId: tuitionIds[3] });
    const res = await student.agent.get(`/api/v1/tuitions/${tuitionIds[3]}`);
    expect(res.body.data.isBookmarked).toBe(true);
  });

  it("is student-only", async () => {
    expect((await tutor.agent.get("/api/v1/bookmarks")).status).toBe(403);
  });
});
