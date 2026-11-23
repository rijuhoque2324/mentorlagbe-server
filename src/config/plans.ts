import { env } from "./env.js";

/**
 * Server-side source of truth for plan pricing and entitlements.
 * The browser never supplies a price; checkout always reads from here.
 *
 * Billing decision: Pro plans are a ONE-TIME payment that grants lifetime Pro
 * for the purchasing account (Stripe Checkout `mode: "payment"`).
 */

export const FREE_TUTOR_POST_LIMIT = 2;
export const FREE_STUDENT_BOOKMARK_LIMIT = 5;

export type PaidPlanId = "student_pro" | "tutor_pro";

export interface PaidPlan {
  id: PaidPlanId;
  role: "student" | "tutor";
  name: string;
  /** Price in major currency units (e.g. dollars). */
  amount: number;
  currency: string;
  billing: "one_time";
  description: string;
  features: string[];
}

export const PAID_PLANS: Record<PaidPlanId, PaidPlan> = {
  student_pro: {
    id: "student_pro",
    role: "student",
    name: "Student Pro",
    amount: 10,
    currency: env.STRIPE_CURRENCY,
    billing: "one_time",
    description: "Unlimited bookmarks and priority booking for students.",
    features: ["Browse tuitions", "Apply for tuition", "Unlimited bookmarks", "Priority booking"],
  },
  tutor_pro: {
    id: "tutor_pro",
    role: "tutor",
    name: "Tutor Pro",
    amount: 15,
    currency: env.STRIPE_CURRENCY,
    billing: "one_time",
    description: "Unlimited tuition posts and a verified badge for tutors.",
    features: ["Unlimited tuition posts", "Manage own posts", "Manage applicants", "Verified badge"],
  },
};

export function isPaidPlanId(value: unknown): value is PaidPlanId {
  return typeof value === "string" && Object.hasOwn(PAID_PLANS, value);
}

/** Amount in the smallest currency unit, as Stripe expects. */
export function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export const PUBLIC_PLAN_CATALOG = {
  student: {
    free: {
      name: "Student Free",
      amount: 0,
      features: ["Browse tuitions", "Apply for tuition", `Up to ${FREE_STUDENT_BOOKMARK_LIMIT} bookmarks`],
    },
    pro: PAID_PLANS.student_pro,
  },
  tutor: {
    free: {
      name: "Tutor Free",
      amount: 0,
      features: [`Maximum ${FREE_TUTOR_POST_LIMIT} tuition posts`, "Manage own posts", "Manage applicants"],
    },
    pro: PAID_PLANS.tutor_pro,
  },
} as const;
