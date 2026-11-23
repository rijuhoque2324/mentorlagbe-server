import express, { Router, type Request, type Response } from "express";
import { z } from "zod";

import { isPaidPlanId, type PaidPlanId } from "../../config/plans.js";
import { authenticate, requireUser } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { sensitiveLimiter } from "../../middlewares/rate-limit.js";
import { body, query, validate } from "../../middlewares/validate.js";
import { logger } from "../../utils/logger.js";
import { paginationSchema } from "../../utils/query.js";
import { sendCreated, sendPaginated, sendSuccess } from "../../utils/response.js";
import {
  constructWebhookEvent,
  createCheckoutSession,
  getCheckoutStatus,
  listUserPayments,
  processWebhookEvent,
} from "./payments.service.js";

const checkoutSchema = z.object({
  plan: z
    .string({ error: "Plan is required" })
    .trim()
    .refine(isPaidPlanId, "Plan must be student_pro or tutor_pro")
    .transform((value) => value as PaidPlanId),
  // Optional hint from the client; validated against the DB role, never trusted.
  role: z.enum(["student", "tutor", "admin"]).optional(),
});

const statusQuery = z.object({
  session_id: z
    .string({ error: "session_id is required" })
    .trim()
    .regex(/^cs_[A-Za-z0-9_]{8,255}$/, "Invalid checkout session id"),
});

export const paymentsRouter = Router();

async function checkout(req: Request, res: Response) {
  const input = body<z.infer<typeof checkoutSchema>>(req);
  const result = await createCheckoutSession(requireUser(req), input.plan, input.role);
  sendCreated(res, result, "Checkout session created");
}

const checkoutChain = [
  authenticate,
  authorize("student", "tutor"),
  sensitiveLimiter,
  validate({ body: checkoutSchema }),
  checkout,
] as const;

paymentsRouter.post("/create-checkout-session", ...checkoutChain);
paymentsRouter.post("/checkout", ...checkoutChain);

paymentsRouter.get(
  "/my",
  authenticate,
  validate({ query: z.object(paginationSchema) }),
  async (req, res) => {
    const { page, limit } = query<{ page: number; limit: number }>(req);
    const { items, meta } = await listUserPayments(requireUser(req), page, limit);
    sendPaginated(res, items, meta, "Payments loaded");
  },
);

paymentsRouter.get("/status", authenticate, validate({ query: statusQuery }), async (req, res) => {
  const { session_id: sessionId } = query<{ session_id: string }>(req);
  sendSuccess(res, await getCheckoutStatus(requireUser(req), sessionId), "Payment status loaded");
});

/**
 * Stripe webhook. Mounted in app.ts BEFORE the JSON body parser so the raw
 * body is preserved for signature verification.
 */
export const stripeWebhookHandler = [
  express.raw({ type: "application/json", limit: "1mb" }),
  async (req: Request, res: Response) => {
    const event = constructWebhookEvent(req.body as Buffer, req.get("stripe-signature"));
    const outcome = await processWebhookEvent(event);
    logger.info("Stripe webhook processed", { eventId: event.id, type: event.type, outcome });
    res.status(200).json({ received: true, outcome });
  },
] as const;
