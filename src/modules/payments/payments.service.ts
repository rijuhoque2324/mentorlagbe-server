import type { Filter, ObjectId } from "mongodb";
import type Stripe from "stripe";

import { env } from "../../config/env.js";
import { PAID_PLANS, toMinorUnits, type PaidPlanId } from "../../config/plans.js";
import { getStripe } from "../../config/stripe.js";
import { COLLECTIONS, payments, users } from "../../db/collections.js";
import type { AuthUser } from "../../types/express.js";
import type { PaymentDoc, UserDoc } from "../../types/models.js";
import { AppError } from "../../utils/app-error.js";
import { logger } from "../../utils/logger.js";
import { containsRegex, skipFor, toObjectId } from "../../utils/query.js";
import { buildMeta } from "../../utils/response.js";

type PaymentWithUser = PaymentDoc & { userDoc?: Pick<UserDoc, "_id" | "name" | "email" | "role">[] };

export function serializePayment(doc: PaymentWithUser, options: { admin?: boolean } = {}) {
  const user = doc.userDoc?.[0];
  return {
    id: doc._id.toHexString(),
    userId: doc.userId.toHexString(),
    userEmail: doc.userEmail,
    role: doc.role,
    plan: doc.plan,
    planName: PAID_PLANS[doc.plan]?.name ?? doc.plan,
    amount: doc.amount,
    currency: doc.currency.toUpperCase(),
    status: doc.status,
    stripeSessionId: doc.stripeSessionId,
    reference: doc.stripeSessionId,
    paidAt: doc.paidAt ?? null,
    isDemo: Boolean(doc.isDemo),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...(options.admin
      ? {
          stripePaymentIntentId: doc.stripePaymentIntentId ?? null,
          failureReason: doc.failureReason ?? null,
          user: user
            ? { id: user._id.toHexString(), name: user.name, email: user.email, role: user.role }
            : { id: doc.userId.toHexString(), email: doc.userEmail },
        }
      : {}),
  };
}

function requireStripe(): Stripe {
  const stripe = getStripe();
  if (!stripe) {
    throw AppError.serviceUnavailable("Payments are not configured on this server");
  }
  return stripe;
}

// ------------------------------------------------------------ checkout

/**
 * Creates a pending payment and a Stripe Checkout Session. The price, currency
 * and plan come from server configuration; the client only names a plan id.
 */
export async function createCheckoutSession(user: AuthUser, planId: PaidPlanId, requestedRole?: string) {
  const stripe = requireStripe();

  if (user.role !== "student" && user.role !== "tutor") {
    throw AppError.forbidden("Only students and tutors can purchase a plan");
  }

  const plan = PAID_PLANS[planId];

  if (plan.role !== user.role || (requestedRole && requestedRole !== user.role)) {
    throw AppError.forbidden(`${plan.name} is only available to ${plan.role} accounts`, "PLAN_ROLE_MISMATCH");
  }

  // Re-read plan from the DB rather than trusting the session snapshot.
  const fresh = await users().findOne({ _id: user._id }, { projection: { plan: 1 } });
  if (fresh?.plan === "pro") {
    throw AppError.conflict("You are already on the Pro plan", "ALREADY_PRO");
  }

  const now = new Date();
  const insert = await payments().insertOne({
    userId: user._id,
    userEmail: user.email,
    role: plan.role,
    plan: plan.id,
    amount: plan.amount,
    currency: plan.currency,
    stripeSessionId: null,
    stripePaymentIntentId: null,
    status: "pending",
    failureReason: null,
    paidAt: null,
    processedEventIds: [],
    createdAt: now,
    updatedAt: now,
  } as unknown as PaymentDoc);

  const paymentId = insert.insertedId.toHexString();
  const metadata = { paymentId, userId: user.id, plan: plan.id, role: plan.role };

  let session: Stripe.Checkout.Session;

  try {
    session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_email: user.email,
        client_reference_id: paymentId,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: plan.currency,
              unit_amount: toMinorUnits(plan.amount),
              product_data: { name: `MentorLagbe ${plan.name}`, description: plan.description },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        success_url: `${env.PRIMARY_CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.PRIMARY_CLIENT_URL}/payment/cancel`,
      },
      { idempotencyKey: `checkout-${paymentId}` },
    );
  } catch (error) {
    await payments().updateOne(
      { _id: insert.insertedId },
      { $set: { status: "failed", failureReason: "checkout_session_creation_failed", updatedAt: new Date() } },
    );
    logger.error("Stripe checkout session creation failed", { paymentId, error });
    throw AppError.badGateway("Could not start checkout. Please try again.");
  }

  await payments().updateOne(
    { _id: insert.insertedId },
    { $set: { stripeSessionId: session.id, updatedAt: new Date() } },
  );

  logger.info("Checkout session created", { paymentId, userId: user.id, plan: plan.id });

  return { url: session.url, sessionId: session.id, paymentId };
}

// ------------------------------------------------------------ reads

export async function listUserPayments(user: AuthUser, page: number, limit: number) {
  const filter = { userId: user._id };
  const [items, total] = await Promise.all([
    payments().find(filter).sort({ createdAt: -1, _id: -1 }).skip(skipFor(page, limit)).limit(limit).toArray(),
    payments().countDocuments(filter),
  ]);
  return { items: items.map((item) => serializePayment(item)), meta: buildMeta(page, limit, total) };
}

/**
 * Checkout verification fallback: when the webhook has not arrived yet, ask
 * Stripe directly for the session and run the same verification + fulfilment
 * path the webhook uses. The plan is only granted when Stripe reports `paid`
 * and every amount/user/plan field matches the server-side record.
 */
async function verifyPendingCheckout(payment: PaymentDoc): Promise<PaymentDoc> {
  if (payment.status !== "pending" || !payment.stripeSessionId) return payment;

  try {
    const stripe = requireStripe();
    const session = await stripe.checkout.sessions.retrieve(payment.stripeSessionId);
    if (session.payment_status !== "paid") return payment;

    const syntheticEvent = { id: `verify_${session.id}`, type: "checkout.session.completed" } as Stripe.Event;
    await handleSessionPaid(syntheticEvent, session);
    return (await payments().findOne({ _id: payment._id })) ?? payment;
  } catch (error) {
    logger.warn("Checkout verification failed", {
      paymentId: payment._id.toHexString(),
      error: error instanceof Error ? error.message : String(error),
    });
    return payment;
  }
}

/** Authoritative checkout result for the purchaser. */
export async function getCheckoutStatus(user: AuthUser, sessionId: string) {
  const found = await payments().findOne({ stripeSessionId: sessionId, userId: user._id });

  if (!found) {
    throw AppError.notFound("Payment not found");
  }

  const payment = await verifyPendingCheckout(found);

  const messages: Record<PaymentDoc["status"], string> = {
    paid: "Payment confirmed. Your Pro plan is active.",
    pending: "We are waiting for Stripe to confirm your payment.",
    failed: "The payment failed. You have not been charged.",
    cancelled: "The checkout session expired or was cancelled.",
  };

  return {
    status: payment.status === "pending" ? "processing" : payment.status,
    plan: payment.plan,
    amount: payment.amount,
    currency: payment.currency.toUpperCase(),
    message: messages[payment.status],
    paidAt: payment.paidAt ?? null,
  };
}

export async function listAllPayments(query: {
  search?: string | undefined;
  status?: PaymentDoc["status"] | undefined;
  page: number;
  limit: number;
}) {
  const filter: Filter<PaymentDoc> = {};
  if (query.status) filter.status = query.status;
  if (query.search) {
    const regex = containsRegex(query.search);
    filter.$or = [{ userEmail: regex }, { stripeSessionId: regex }, { plan: regex }];
  }

  const [items, total] = await Promise.all([
    payments()
      .aggregate<PaymentWithUser>([
        { $match: filter },
        { $sort: { createdAt: -1, _id: -1 } },
        { $skip: skipFor(query.page, query.limit) },
        { $limit: query.limit },
        {
          $lookup: {
            from: COLLECTIONS.users,
            localField: "userId",
            foreignField: "_id",
            as: "userDoc",
            pipeline: [{ $project: { name: 1, email: 1, role: 1 } }],
          },
        },
      ])
      .toArray(),
    payments().countDocuments(filter),
  ]);

  return {
    items: items.map((item) => serializePayment(item, { admin: true })),
    meta: buildMeta(query.page, query.limit, total),
  };
}

// ------------------------------------------------------------ webhook

export function constructWebhookEvent(rawBody: Buffer, signature: string | undefined): Stripe.Event {
  const stripe = requireStripe();

  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw AppError.serviceUnavailable("Stripe webhook secret is not configured");
  }

  if (!signature) {
    throw AppError.badRequest("Missing Stripe-Signature header", { code: "INVALID_SIGNATURE" });
  }

  if (!Buffer.isBuffer(rawBody)) {
    throw AppError.badRequest("Webhook body must be the raw request payload", { code: "INVALID_SIGNATURE" });
  }

  try {
    return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch {
    throw AppError.badRequest("Invalid Stripe webhook signature", { code: "INVALID_SIGNATURE" });
  }
}

async function findPaymentForSession(session: Stripe.Checkout.Session): Promise<PaymentDoc | null> {
  const bySession = await payments().findOne({ stripeSessionId: session.id });
  if (bySession) return bySession;

  // The webhook can race the session-id write in createCheckoutSession.
  const paymentId = session.metadata?.paymentId ?? session.client_reference_id;
  if (paymentId && /^[a-f0-9]{24}$/i.test(paymentId)) {
    const byId = await payments().findOne({ _id: toObjectId(paymentId) });
    if (byId && (byId.stripeSessionId === null || byId.stripeSessionId === session.id)) {
      return byId;
    }
  }

  return null;
}

/** Every field must match what the server itself configured for the payment. */
function verifySession(session: Stripe.Checkout.Session, payment: PaymentDoc): string | null {
  const plan = PAID_PLANS[payment.plan];
  if (!plan) return "unknown_plan";
  if (session.mode !== "payment") return "unexpected_mode";
  if (session.payment_status !== "paid") return "not_paid";
  if (session.amount_total !== toMinorUnits(payment.amount)) return "amount_mismatch";
  if (toMinorUnits(payment.amount) !== toMinorUnits(plan.amount)) return "configured_amount_mismatch";
  if ((session.currency ?? "").toLowerCase() !== payment.currency.toLowerCase()) return "currency_mismatch";
  if (session.metadata?.userId !== payment.userId.toHexString()) return "user_mismatch";
  if (session.metadata?.plan !== payment.plan) return "plan_mismatch";
  if (session.metadata?.paymentId && session.metadata.paymentId !== payment._id.toHexString()) return "payment_mismatch";
  return null;
}

async function markProcessed(paymentId: ObjectId, eventId: string) {
  await payments().updateOne({ _id: paymentId }, { $addToSet: { processedEventIds: eventId } });
}

async function handleSessionPaid(event: Stripe.Event, session: Stripe.Checkout.Session) {
  const payment = await findPaymentForSession(session);

  if (!payment) {
    logger.warn("Webhook for unknown checkout session", { eventId: event.id, sessionId: session.id });
    return "ignored_unknown_session";
  }

  if (payment.processedEventIds?.includes(event.id) || payment.status === "paid") {
    return "duplicate";
  }

  const mismatch = verifySession(session, payment);

  if (mismatch) {
    if (mismatch === "not_paid") {
      // checkout.session.completed with an async (delayed) payment method.
      await markProcessed(payment._id, event.id);
      return "awaiting_async_payment";
    }

    await payments().updateOne(
      { _id: payment._id, status: "pending" },
      {
        $set: { status: "failed", failureReason: `verification_failed:${mismatch}`, updatedAt: new Date() },
        $addToSet: { processedEventIds: event.id },
      },
    );
    logger.error("Stripe session failed verification", {
      eventId: event.id,
      paymentId: payment._id.toHexString(),
      reason: mismatch,
    });
    return "verification_failed";
  }

  const now = new Date();

  // Upgrade first; it is idempotent. If the process dies before the payment
  // is marked paid, Stripe's retry re-runs both steps safely.
  await users().updateOne(
    { _id: payment.userId },
    { $set: { plan: "pro", planActivatedAt: now, updatedAt: now } },
  );

  const paymentIntent =
    typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);

  await payments().updateOne(
    { _id: payment._id, status: { $in: ["pending", "failed", "cancelled"] } },
    {
      $set: {
        status: "paid",
        stripeSessionId: session.id,
        stripePaymentIntentId: paymentIntent,
        paidAt: now,
        failureReason: null,
        updatedAt: now,
      },
      $addToSet: { processedEventIds: event.id },
    },
  );

  logger.info("Payment confirmed and plan upgraded", {
    eventId: event.id,
    paymentId: payment._id.toHexString(),
    userId: payment.userId.toHexString(),
    plan: payment.plan,
  });

  return "paid";
}

async function handleSessionClosed(
  event: Stripe.Event,
  session: Stripe.Checkout.Session,
  status: "failed" | "cancelled",
  reason: string,
) {
  const payment = await findPaymentForSession(session);
  if (!payment) return "ignored_unknown_session";
  if (payment.processedEventIds?.includes(event.id)) return "duplicate";

  await payments().updateOne(
    { _id: payment._id, status: "pending" },
    { $set: { status, failureReason: reason, updatedAt: new Date() } },
  );
  await markProcessed(payment._id, event.id);

  logger.info("Payment closed without success", { eventId: event.id, paymentId: payment._id.toHexString(), status });
  return status;
}

/** Idempotent: re-delivered events are detected and acknowledged without effect. */
export async function processWebhookEvent(event: Stripe.Event): Promise<string> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return handleSessionPaid(event, event.data.object as Stripe.Checkout.Session);

    case "checkout.session.async_payment_failed":
      return handleSessionClosed(event, event.data.object as Stripe.Checkout.Session, "failed", "async_payment_failed");

    case "checkout.session.expired":
      return handleSessionClosed(event, event.data.object as Stripe.Checkout.Session, "cancelled", "session_expired");

    default:
      return "ignored_event_type";
  }
}
