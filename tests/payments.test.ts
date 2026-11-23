import { ObjectId } from "mongodb";
import request from "supertest";
import Stripe from "stripe";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { setupTestApp, signUp, WEBHOOK_SECRET, type TestContext } from "./helpers/setup.js";

let ctx: TestContext;
let stripe: Stripe;
let createSession: ReturnType<typeof vi.fn>;
let sessionCounter = 0;

beforeAll(async () => {
  ctx = await setupTestApp();
  const { setStripeClient } = await import("../src/config/stripe.js");
  stripe = new Stripe("sk_test_mentorlagbe_dummy");
  createSession = vi.fn();
  (stripe.checkout.sessions as unknown as { create: unknown }).create = createSession;
  setStripeClient(stripe);
});

beforeEach(() => {
  createSession.mockReset();
  createSession.mockImplementation(async (params: Stripe.Checkout.SessionCreateParams) => {
    sessionCounter += 1;
    const id = `cs_test_session${sessionCounter}abcdef`;
    return { id, url: `https://checkout.stripe.com/c/pay/${id}`, metadata: params.metadata };
  });
});

afterAll(async () => {
  await ctx?.close();
});

function signedEvent(type: string, object: Record<string, unknown>, id = `evt_${Math.random().toString(36).slice(2)}`) {
  const payload = JSON.stringify({ id, object: "event", type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return { payload, header, id };
}

function sendWebhook(payload: string, header: string) {
  return request(ctx.app)
    .post("/api/v1/payments/webhook")
    .set("Content-Type", "application/json")
    .set("Stripe-Signature", header)
    .send(payload);
}

async function startCheckout(role: "student" | "tutor") {
  const user = await signUp(ctx, role);
  const plan = role === "student" ? "student_pro" : "tutor_pro";
  const res = await user.agent.post("/api/v1/payments/checkout").send({ plan, role, amount: 1 });
  return { user, res, plan };
}

function completedSession(sessionId: string, user: { id: string }, plan: string, paymentId: string, amount: number) {
  return {
    id: sessionId,
    object: "checkout.session",
    mode: "payment",
    payment_status: "paid",
    amount_total: amount,
    currency: "usd",
    payment_intent: "pi_test_123",
    client_reference_id: paymentId,
    metadata: { paymentId, userId: user.id, plan, role: plan.split("_")[0] },
  };
}

describe("plans", () => {
  it("lists plans publicly", async () => {
    const res = await request(ctx.app).get("/api/v1/plans");
    expect(res.status).toBe(200);
    expect(res.body.data.plans.student.pro.amount).toBe(10);
    expect(res.body.data.plans.tutor.pro.amount).toBe(15);
  });
});

describe("checkout", () => {
  it("uses server-side pricing and stores a pending payment", async () => {
    const { user, res } = await startCheckout("tutor");
    expect(res.status).toBe(201);
    expect(res.body.data.url).toMatch(/^https:\/\/checkout\.stripe\.com/);

    const params = createSession.mock.calls[0]![0] as Stripe.Checkout.SessionCreateParams;
    expect(params.line_items?.[0]?.price_data?.unit_amount).toBe(1500);
    expect(params.mode).toBe("payment");
    expect(params.metadata).toMatchObject({ userId: user.id, plan: "tutor_pro" });

    const payment = await ctx.db.collection("payments").findOne({ userId: new ObjectId(user.id) });
    expect(payment).toMatchObject({ status: "pending", amount: 15, plan: "tutor_pro", stripeSessionId: res.body.data.sessionId });
  });

  it("rejects buying the other role's plan", async () => {
    const student = await signUp(ctx, "student");
    const res = await student.agent.post("/api/v1/payments/create-checkout-session").send({ plan: "tutor_pro" });
    expect(res.status).toBe(403);
    expect(createSession).not.toHaveBeenCalled();
  });

  it("rejects admins, unknown plans and already-pro users", async () => {
    const admin = await signUp(ctx, "admin");
    expect((await admin.agent.post("/api/v1/payments/checkout").send({ plan: "student_pro" })).status).toBe(403);

    const student = await signUp(ctx, "student");
    expect((await student.agent.post("/api/v1/payments/checkout").send({ plan: "gold" })).status).toBe(400);

    const pro = await signUp(ctx, "student", { plan: "pro" });
    expect((await pro.agent.post("/api/v1/payments/checkout").send({ plan: "student_pro" })).status).toBe(409);
  });

  it("marks the payment failed if Stripe errors", async () => {
    createSession.mockRejectedValueOnce(new Error("stripe down"));
    const { user, res } = await startCheckout("student");
    expect(res.status).toBe(502);
    const payment = await ctx.db.collection("payments").findOne({ userId: new ObjectId(user.id) });
    expect(payment?.status).toBe("failed");
  });
});

describe("webhook", () => {
  it("rejects missing or invalid signatures", async () => {
    const payload = JSON.stringify({ id: "evt_x", type: "checkout.session.completed", data: { object: {} } });
    const noSig = await request(ctx.app).post("/api/v1/payments/webhook").set("Content-Type", "application/json").send(payload);
    expect(noSig.status).toBe(400);

    const bad = await sendWebhook(payload, "t=1,v1=deadbeef");
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("INVALID_SIGNATURE");
  });

  it("does not upgrade on the success redirect, only on a verified webhook", async () => {
    const { user, res, plan } = await startCheckout("student");
    const sessionId = res.body.data.sessionId as string;

    const status = await user.agent.get("/api/v1/payments/status").query({ session_id: sessionId });
    expect(status.body.data.status).toBe("processing");
    expect((await user.agent.get("/api/v1/users/me")).body.data.plan).toBe("free");

    const { payload, header } = signedEvent(
      "checkout.session.completed",
      completedSession(sessionId, user, plan, res.body.data.paymentId, 1000),
    );
    const hook = await sendWebhook(payload, header);
    expect(hook.status).toBe(200);
    expect(hook.body.outcome).toBe("paid");

    expect((await user.agent.get("/api/v1/users/me")).body.data.plan).toBe("pro");
    const after = await user.agent.get("/api/v1/payments/status").query({ session_id: sessionId });
    expect(after.body.data).toMatchObject({ status: "paid", plan: "student_pro", amount: 10, currency: "USD" });
  });

  it("is idempotent on retries", async () => {
    const { user, res, plan } = await startCheckout("tutor");
    const session = completedSession(res.body.data.sessionId, user, plan, res.body.data.paymentId, 1500);
    const { payload, header, id } = signedEvent("checkout.session.completed", session);

    expect((await sendWebhook(payload, header)).body.outcome).toBe("paid");
    const replay = await sendWebhook(payload, header);
    expect(replay.status).toBe(200);
    expect(replay.body.outcome).toBe("duplicate");

    const payment = await ctx.db.collection("payments").findOne({ stripeSessionId: res.body.data.sessionId });
    expect(payment?.processedEventIds).toEqual([id]);
    expect(payment?.status).toBe("paid");
  });

  it("refuses to upgrade when the amount does not match", async () => {
    const { user, res, plan } = await startCheckout("tutor");
    const session = completedSession(res.body.data.sessionId, user, plan, res.body.data.paymentId, 100);
    const { payload, header } = signedEvent("checkout.session.completed", session);

    const hook = await sendWebhook(payload, header);
    expect(hook.body.outcome).toBe("verification_failed");
    expect((await user.agent.get("/api/v1/users/me")).body.data.plan).toBe("free");
    const payment = await ctx.db.collection("payments").findOne({ stripeSessionId: res.body.data.sessionId });
    expect(payment).toMatchObject({ status: "failed", failureReason: "verification_failed:amount_mismatch" });
  });

  it("refuses to upgrade when metadata names another user", async () => {
    const { res, plan } = await startCheckout("student");
    const attacker = await signUp(ctx, "student");
    const session = completedSession(res.body.data.sessionId, attacker, plan, res.body.data.paymentId, 1000);
    const { payload, header } = signedEvent("checkout.session.completed", session);

    expect((await sendWebhook(payload, header)).body.outcome).toBe("verification_failed");
    expect((await attacker.agent.get("/api/v1/users/me")).body.data.plan).toBe("free");
  });

  it("marks expired sessions as cancelled", async () => {
    const { user, res } = await startCheckout("student");
    const { payload, header } = signedEvent("checkout.session.expired", {
      id: res.body.data.sessionId,
      object: "checkout.session",
      metadata: { paymentId: res.body.data.paymentId },
    });
    expect((await sendWebhook(payload, header)).body.outcome).toBe("cancelled");
    const status = await user.agent.get("/api/v1/payments/status").query({ session_id: res.body.data.sessionId });
    expect(status.body.data.status).toBe("cancelled");
  });

  it("lists the user's own payments only", async () => {
    const { user } = await startCheckout("student");
    await startCheckout("student");
    const res = await user.agent.get("/api/v1/payments/my");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].userId).toBe(user.id);
  });

  it("does not reveal another user's checkout status", async () => {
    const { res } = await startCheckout("student");
    const other = await signUp(ctx, "student");
    expect((await other.agent.get("/api/v1/payments/status").query({ session_id: res.body.data.sessionId })).status).toBe(404);
  });
});
