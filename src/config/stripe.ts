import Stripe from "stripe";

import { env } from "./env.js";

let stripeClient: Stripe | null = null;

/** Returns the configured Stripe client, or null when Stripe is not configured. */
export function getStripe(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) {
    return null;
  }

  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "mentorlagbe-server" },
    });
  }

  return stripeClient;
}

/** Test hook: replace the Stripe client (e.g. with a mock). */
export function setStripeClient(client: Stripe | null): void {
  stripeClient = client;
}
