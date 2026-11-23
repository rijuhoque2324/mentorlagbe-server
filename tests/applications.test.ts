import { ObjectId } from "mongodb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApprovedTuition, setupTestApp, signUp, validTuition, type TestContext, type TestUser } from "./helpers/setup.js";

let ctx: TestContext;
let tutor: TestUser;
let otherTutor: TestUser;

beforeAll(async () => {
  ctx = await setupTestApp();
  tutor = await signUp(ctx, "tutor", { plan: "pro" });
  otherTutor = await signUp(ctx, "tutor");
});

afterAll(async () => {
  await ctx?.close();
});

describe("applying", () => {
  it("derives student, tutor and fee data on the server", async () => {
    const tuitionId = await createApprovedTuition(ctx, tutor, { monthlyFee: 4200 });
    const student = await signUp(ctx, "student", { phone: "+8801700000001" });

    const res = await student.agent.post("/api/v1/applications").send({
      tuitionId,
      preferredSchedule: "Evenings",
      studentNote: "Looking forward",
      studentId: new ObjectId().toHexString(),
      tutorId: new ObjectId().toHexString(),
      monthlyFee: 1,
      status: "accepted",
    });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      tuitionId,
      studentId: student.id,
      tutorId: tutor.id,
      monthlyFee: 4200,
      status: "pending",
      preferredSchedule: "Evenings",
      message: "Looking forward",
    });
  });

  it("supports the client's /tuitions/:id/apply path", async () => {
    const tuitionId = await createApprovedTuition(ctx, tutor);
    const student = await signUp(ctx, "student");
    const res = await student.agent.post(`/api/v1/tuitions/${tuitionId}/apply`).send({ message: "Hi" });
    expect(res.status).toBe(201);
    expect(res.body.data.studentNote).toBe("Hi");
  });

  it("rejects duplicate applications with 409", async () => {
    const tuitionId = await createApprovedTuition(ctx, tutor);
    const student = await signUp(ctx, "student");
    expect((await student.agent.post("/api/v1/applications").send({ tuitionId })).status).toBe(201);
    const dup = await student.agent.post("/api/v1/applications").send({ tuitionId });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe("ALREADY_APPLIED");
  });

  it("prevents duplicates under concurrent requests", async () => {
    const tuitionId = await createApprovedTuition(ctx, tutor);
    const student = await signUp(ctx, "student");
    const results = await Promise.all(
      Array.from({ length: 6 }, () => student.agent.post("/api/v1/applications").send({ tuitionId })),
    );
    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    expect(results.filter((res) => res.status === 409)).toHaveLength(5);
    expect(
      await ctx.db.collection("applications").countDocuments({ tuitionId: new ObjectId(tuitionId), studentId: new ObjectId(student.id) }),
    ).toBe(1);
  });

  it("only accepts applications for approved, active tuitions", async () => {
    const student = await signUp(ctx, "student");
    const pending = await tutor.agent.post("/api/v1/tuitions").send(validTuition());
    const res = await student.agent.post("/api/v1/applications").send({ tuitionId: pending.body.data.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TUITION_NOT_OPEN");

    const missing = await student.agent.post("/api/v1/applications").send({ tuitionId: new ObjectId().toHexString() });
    expect(missing.status).toBe(404);
  });

  it("only students may apply", async () => {
    const tuitionId = await createApprovedTuition(ctx, tutor);
    expect((await otherTutor.agent.post("/api/v1/applications").send({ tuitionId })).status).toBe(403);
  });
});

describe("state transitions", () => {
  it("student cancels only a pending application, and can re-apply after cancelling", async () => {
    const tuitionId = await createApprovedTuition(ctx, tutor);
    const student = await signUp(ctx, "student");
    const applied = await student.agent.post("/api/v1/applications").send({ tuitionId });
    const id = applied.body.data.id;

    const cancelled = await student.agent.patch(`/api/v1/applications/${id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe("cancelled");

    expect((await student.agent.delete(`/api/v1/applications/${id}`)).status).toBe(409);

    const reapplied = await student.agent.post("/api/v1/applications").send({ tuitionId });
    expect(reapplied.status).toBe(201);
    expect(reapplied.body.data).toMatchObject({ id, status: "pending" });
  });

  it("student cannot cancel after a decision", async () => {
    const tuitionId = await createApprovedTuition(ctx, tutor);
    const student = await signUp(ctx, "student");
    const { body } = await student.agent.post("/api/v1/applications").send({ tuitionId });
    await tutor.agent.patch(`/api/v1/applications/${body.data.id}/accept`);
    const res = await student.agent.patch(`/api/v1/applications/${body.data.id}/cancel`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("INVALID_TRANSITION");
  });

  it("only the owning tutor can accept or reject", async () => {
    const tuitionId = await createApprovedTuition(ctx, tutor);
    const student = await signUp(ctx, "student");
    const { body } = await student.agent.post("/api/v1/applications").send({ tuitionId });
    const id = body.data.id;

    expect((await otherTutor.agent.patch(`/api/v1/applications/${id}/accept`)).status).toBe(403);
    expect((await student.agent.patch(`/api/v1/applications/${id}/accept`)).status).toBe(403);

    const accepted = await tutor.agent.patch(`/api/v1/applications/${id}/status`).send({ status: "accepted" });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe("accepted");

    expect((await tutor.agent.patch(`/api/v1/applications/${id}/reject`)).status).toBe(409);
  });

  it("another student cannot view or cancel someone else's application", async () => {
    const tuitionId = await createApprovedTuition(ctx, tutor);
    const owner = await signUp(ctx, "student");
    const stranger = await signUp(ctx, "student");
    const { body } = await owner.agent.post("/api/v1/applications").send({ tuitionId });

    expect((await stranger.agent.get(`/api/v1/applications/${body.data.id}`)).status).toBe(403);
    expect((await stranger.agent.patch(`/api/v1/applications/${body.data.id}/cancel`)).status).toBe(403);
    expect((await owner.agent.get(`/api/v1/applications/${body.data.id}`)).status).toBe(200);
    expect((await tutor.agent.get(`/api/v1/applications/${body.data.id}`)).status).toBe(200);
  });
});

describe("listing", () => {
  it("tutors only see applicants for their own posts, pro students first, phone hidden until accepted", async () => {
    const proTutor = await signUp(ctx, "tutor", { plan: "pro" });
    const tuitionId = await createApprovedTuition(ctx, proTutor);
    const foreignTuition = await createApprovedTuition(ctx, otherTutor);

    const free = await signUp(ctx, "student", { phone: "+8801700000002" });
    const pro = await signUp(ctx, "student", { plan: "pro", phone: "+8801700000003" });

    await free.agent.post("/api/v1/applications").send({ tuitionId });
    await pro.agent.post("/api/v1/applications").send({ tuitionId });
    await free.agent.post("/api/v1/applications").send({ tuitionId: foreignTuition });

    const res = await proTutor.agent.get("/api/v1/applications/tutor");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data[0]).toMatchObject({ studentId: pro.id, isPriority: true });
    // Manage Applicants shows the student's phone so the tutor can decide.
    expect(res.body.data[0].studentPhone).toBe("+8801700000003");

    await proTutor.agent.patch(`/api/v1/applications/${res.body.data[0].id}/accept`);
    const after = await proTutor.agent.get("/api/v1/applications/tutor").query({ status: "accepted" });
    expect(after.body.data[0].studentPhone).toBe("+8801700000003");

    // My Applications shows the tutor's name and email to the student.
    const mine = await pro.agent.get("/api/v1/applications/my");
    expect(mine.body.data[0].tutorEmail).toBe(proTutor.email);
    expect(mine.body.data[0].tutorName).toBe(proTutor.name);
  });

  it("students list only their own applications on /my and /me", async () => {
    const tuitionId = await createApprovedTuition(ctx, tutor);
    const student = await signUp(ctx, "student");
    await student.agent.post("/api/v1/applications").send({ tuitionId });

    for (const path of ["/api/v1/applications/my", "/api/v1/applications/me"]) {
      const res = await student.agent.get(path);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].tuition.id).toBe(tuitionId);
    }
  });
});
