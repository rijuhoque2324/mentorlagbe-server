import { ObjectId } from "mongodb";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createApprovedTuition,
  setupTestApp,
  signUp,
  validTuition,
  type TestContext,
  type TestUser,
} from "./helpers/setup.js";

let ctx: TestContext;
let admin: TestUser;

beforeAll(async () => {
  ctx = await setupTestApp();
  admin = await signUp(ctx, "admin");
});

afterAll(async () => {
  await ctx?.close();
});

describe("tuition creation", () => {
  it("lets a tutor create a pending post with server-assigned ownership", async () => {
    const tutor = await signUp(ctx, "tutor");
    const intruderId = new ObjectId().toHexString();

    const res = await tutor.agent
      .post("/api/v1/tuitions")
      .send(validTuition({ tutorId: intruderId, approvalStatus: "approved", mode: "Online" }));

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      tutorId: tutor.id,
      approvalStatus: "pending",
      status: "pending",
      mode: "online",
    });
  });

  it("forbids students from creating tuitions", async () => {
    const student = await signUp(ctx, "student");
    const res = await student.agent.post("/api/v1/tuitions").send(validTuition());
    expect(res.status).toBe(403);
  });

  it("requires authentication", async () => {
    const res = await request(ctx.app).post("/api/v1/tuitions").send(validTuition());
    expect(res.status).toBe(401);
  });

  it("validates fields", async () => {
    const tutor = await signUp(ctx, "tutor");
    const res = await tutor.agent
      .post("/api/v1/tuitions")
      .send(validTuition({ monthlyFee: -5, daysPerWeek: 9, mode: "teleport", title: "x" }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    const fields = res.body.errors.map((error: { field: string }) => error.field);
    expect(fields).toEqual(expect.arrayContaining(["monthlyFee", "daysPerWeek", "mode", "title"]));
  });

  it("limits free tutors to two posts", async () => {
    const tutor = await signUp(ctx, "tutor");
    expect((await tutor.agent.post("/api/v1/tuitions").send(validTuition())).status).toBe(201);
    expect((await tutor.agent.post("/api/v1/tuitions").send(validTuition())).status).toBe(201);
    const third = await tutor.agent.post("/api/v1/tuitions").send(validTuition());
    expect(third.status).toBe(409);
    expect(third.body.code).toBe("PLAN_LIMIT_REACHED");
  });

  it("holds the free limit under concurrent requests", async () => {
    const tutor = await signUp(ctx, "tutor");
    const results = await Promise.all(
      Array.from({ length: 5 }, () => tutor.agent.post("/api/v1/tuitions").send(validTuition())),
    );
    expect(results.filter((res) => res.status === 201).length).toBeLessThanOrEqual(2);
    expect(await ctx.db.collection("tuitions").countDocuments({ tutorId: new ObjectId(tutor.id) })).toBeLessThanOrEqual(2);
  });

  it("frees a slot when a post is deleted", async () => {
    const tutor = await signUp(ctx, "tutor");
    const first = await tutor.agent.post("/api/v1/tuitions").send(validTuition());
    await tutor.agent.post("/api/v1/tuitions").send(validTuition());
    expect((await tutor.agent.delete(`/api/v1/tuitions/${first.body.data.id}`)).status).toBe(200);
    expect((await tutor.agent.post("/api/v1/tuitions").send(validTuition())).status).toBe(201);
  });

  it("gives pro tutors unlimited posts", async () => {
    const tutor = await signUp(ctx, "tutor", { plan: "pro" });
    for (let i = 0; i < 4; i += 1) {
      expect((await tutor.agent.post("/api/v1/tuitions").send(validTuition())).status).toBe(201);
    }
  });
});

describe("public listing", () => {
  it("shows only approved and active posts", async () => {
    const tutor = await signUp(ctx, "tutor", { plan: "pro" });
    const approvedId = await createApprovedTuition(ctx, tutor, { title: "Visible approved tuition" });
    const inactiveId = await createApprovedTuition(ctx, tutor, { title: "Inactive approved tuition" });
    await tutor.agent.patch(`/api/v1/tuitions/${inactiveId}/status`).send({ isActive: false });
    const pending = await tutor.agent.post("/api/v1/tuitions").send(validTuition({ title: "Pending tuition post" }));
    const rejected = await tutor.agent.post("/api/v1/tuitions").send(validTuition({ title: "Rejected tuition post" }));
    await admin.agent.patch(`/api/v1/admin/tuitions/${rejected.body.data.id}/reject`).send({ reason: "Incomplete details" });

    const res = await request(ctx.app).get("/api/v1/tuitions").query({ limit: 50 });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((item: { id: string }) => item.id);
    expect(ids).toContain(approvedId);
    expect(ids).not.toContain(inactiveId);
    expect(ids).not.toContain(pending.body.data.id);
    expect(ids).not.toContain(rejected.body.data.id);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 50 });

    expect((await request(ctx.app).get(`/api/v1/tuitions/${pending.body.data.id}`)).status).toBe(404);
    expect((await request(ctx.app).get(`/api/v1/tuitions/${approvedId}`)).status).toBe(200);
    // The owner can still view their unpublished post.
    expect((await tutor.agent.get(`/api/v1/tuitions/${pending.body.data.id}`)).status).toBe(200);
  });

  it("does not expose tutor email publicly", async () => {
    const tutor = await signUp(ctx, "tutor");
    const id = await createApprovedTuition(ctx, tutor);
    const res = await request(ctx.app).get(`/api/v1/tuitions/${id}`);
    expect(res.body.data).not.toHaveProperty("tutorEmail");
    expect(res.body.data.tutor).not.toHaveProperty("email");
  });

  it("filters and sorts", async () => {
    const tutor = await signUp(ctx, "tutor", { plan: "pro" });
    await createApprovedTuition(ctx, tutor, { subject: "Chemistry", monthlyFee: 3000, mode: "online", location: "Mirpur" });
    await createApprovedTuition(ctx, tutor, { subject: "Chemistry", monthlyFee: 9000, mode: "online", location: "Mirpur" });

    const res = await request(ctx.app)
      .get("/api/v1/tuitions")
      .query({ subject: "chemistry", minFee: 2000, maxFee: 10000, mode: "Online", sort: "fee_desc" });
    expect(res.status).toBe(200);
    const fees = res.body.data.map((item: { monthlyFee: number }) => item.monthlyFee);
    expect(fees).toEqual([...fees].sort((a, b) => b - a));
    expect(res.body.data.every((item: { subject: string }) => item.subject === "Chemistry")).toBe(true);
  });

  it("treats search input literally (no regex injection)", async () => {
    const res = await request(ctx.app).get("/api/v1/tuitions").query({ search: ".*(a+)+$" });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it("rejects invalid pagination and filters", async () => {
    expect((await request(ctx.app).get("/api/v1/tuitions").query({ limit: 1000 })).status).toBe(400);
    expect((await request(ctx.app).get("/api/v1/tuitions").query({ minFee: 10, maxFee: 5 })).status).toBe(400);
    expect((await request(ctx.app).get("/api/v1/tuitions").query({ sort: "$where" })).status).toBe(400);
    expect((await request(ctx.app).get("/api/v1/tuitions/not-an-id")).status).toBe(400);
  });

  it("serves featured tuitions", async () => {
    const res = await request(ctx.app).get("/api/v1/tuitions/featured").query({ limit: 3 });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(3);
  });
});

describe("ownership", () => {
  it("only the owner can update or delete", async () => {
    const owner = await signUp(ctx, "tutor");
    const other = await signUp(ctx, "tutor");
    const id = await createApprovedTuition(ctx, owner);

    expect((await other.agent.patch(`/api/v1/tuitions/${id}`).send({ title: "Hijacked title" })).status).toBe(403);
    expect((await other.agent.delete(`/api/v1/tuitions/${id}`)).status).toBe(403);
    expect((await admin.agent.patch(`/api/v1/tuitions/${id}`).send({ title: "Admin edit attempt" })).status).toBe(403);

    const ok = await owner.agent.patch(`/api/v1/tuitions/${id}`).send({ monthlyFee: 6500 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.monthlyFee).toBe(6500);
  });

  it("re-submits an approved post for moderation when content changes", async () => {
    const owner = await signUp(ctx, "tutor");
    const id = await createApprovedTuition(ctx, owner);

    const toggled = await owner.agent.patch(`/api/v1/tuitions/${id}`).send({ isActive: false });
    expect(toggled.body.data.approvalStatus).toBe("approved");

    const edited = await owner.agent.patch(`/api/v1/tuitions/${id}`).send({ description: "Brand new description that is long enough." });
    expect(edited.body.data.approvalStatus).toBe("pending");
  });

  it("lists only the tutor's own posts", async () => {
    const owner = await signUp(ctx, "tutor");
    const other = await signUp(ctx, "tutor");
    await owner.agent.post("/api/v1/tuitions").send(validTuition());
    await other.agent.post("/api/v1/tuitions").send(validTuition());

    for (const path of ["/api/v1/tuitions/mine", "/api/v1/tutor/tuitions"]) {
      const res = await owner.agent.get(path);
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].tutorId).toBe(owner.id);
    }
  });

  it("deleting a tuition removes its applications and bookmarks", async () => {
    const owner = await signUp(ctx, "tutor");
    const student = await signUp(ctx, "student");
    const id = await createApprovedTuition(ctx, owner);
    await student.agent.post(`/api/v1/tuitions/${id}/apply`).send({});
    await student.agent.post("/api/v1/bookmarks").send({ tuitionId: id });

    await owner.agent.delete(`/api/v1/tuitions/${id}`);
    expect(await ctx.db.collection("applications").countDocuments({ tuitionId: new ObjectId(id) })).toBe(0);
    expect(await ctx.db.collection("bookmarks").countDocuments({ tuitionId: new ObjectId(id) })).toBe(0);
  });
});

describe("moderation", () => {
  it("only admins can approve or reject", async () => {
    const tutor = await signUp(ctx, "tutor");
    const created = await tutor.agent.post("/api/v1/tuitions").send(validTuition());
    const id = created.body.data.id;

    expect((await tutor.agent.patch(`/api/v1/admin/tuitions/${id}/approve`)).status).toBe(403);

    const approved = await admin.agent.patch(`/api/v1/admin/tuitions/${id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.data.status).toBe("approved");

    expect((await admin.agent.patch(`/api/v1/admin/tuitions/${id}/approve`)).status).toBe(409);

    const doc = await ctx.db.collection("tuitions").findOne({ _id: new ObjectId(id) });
    expect(doc?.moderatedBy?.toHexString()).toBe(admin.id);
    expect(doc?.moderationHistory.at(-1).action).toBe("approved");
  });

  it("requires a reason to reject, via both reject and moderate endpoints", async () => {
    const tutor = await signUp(ctx, "tutor");
    const created = await tutor.agent.post("/api/v1/tuitions").send(validTuition());
    const id = created.body.data.id;

    expect((await admin.agent.patch(`/api/v1/admin/tuitions/${id}/reject`).send({})).status).toBe(400);
    expect((await admin.agent.patch(`/api/v1/admin/tuitions/${id}/moderate`).send({ status: "rejected" })).status).toBe(400);

    const res = await admin.agent
      .patch(`/api/v1/admin/tuitions/${id}/moderate`)
      .send({ status: "rejected", reason: "Fee looks incorrect" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "rejected", rejectionReason: "Fee looks incorrect" });
  });
});
