import type { Server } from "node:http";

import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/db.js";
import { env } from "./config/env.js";
import { getStripe } from "./config/stripe.js";
import { ensureIndexes } from "./db/collections.js";
import { initAuth } from "./lib/auth.js";
import { logger } from "./utils/logger.js";

async function main() {
  const db = await connectDatabase();
  await ensureIndexes(db);

  const auth = initAuth(db);
  const app = createApp(auth);

  if (!getStripe() || !env.STRIPE_WEBHOOK_SECRET) {
    logger.warn("Stripe is not fully configured; payment endpoints will return 503");
  }
  if (!env.IMGBB_API_KEY) {
    logger.warn("IMGBB_API_KEY is not set; image upload endpoints will return 503");
  }

  const server: Server = app.listen(env.PORT, () => {
    logger.info("MentorLagbe API listening", { port: env.PORT, env: env.NODE_ENV });
  });

  const shutdown = (signal: string) => {
    logger.info("Shutting down", { signal });
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason });
});

main().catch((error) => {
  logger.error("Failed to start server", { error });
  process.exit(1);
});
