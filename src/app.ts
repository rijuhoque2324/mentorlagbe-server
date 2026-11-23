import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";

import { env } from "./config/env.js";
import type { Auth } from "./lib/auth.js";
import { errorHandler, notFoundHandler } from "./middlewares/error-handler.js";
import { apiLimiter } from "./middlewares/rate-limit.js";
import { requestContext } from "./middlewares/request-context.js";
import { mountBetterAuth } from "./modules/auth/auth.routes.js";
import { stripeWebhookHandler } from "./modules/payments/payments.routes.js";
import { apiRouter } from "./routes/index.js";

export const API_PREFIX = "/api/v1";

export function createApp(auth: Auth): Express {
  const app = express();

  if (env.TRUST_PROXY > 0) {
    app.set("trust proxy", env.TRUST_PROXY);
  }

  app.disable("x-powered-by");
  app.use(requestContext);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        // Non-browser clients (curl, Stripe webhooks) send no Origin header.
        if (!origin || env.CLIENT_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposedHeaders: ["X-Request-Id"],
      maxAge: 600,
    }),
  );

  // Raw-body routes must be registered before any JSON parser.
  app.post(`${API_PREFIX}/payments/webhook`, ...stripeWebhookHandler);
  mountBetterAuth(app, auth);

  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));

  app.get("/", (_req, res) => {
    res.json({
      success: true,
      message: "MentorLagbe API is running",
      data: { name: "mentorlagbe-server", apiBase: API_PREFIX, auth: "/api/auth", health: `${API_PREFIX}/health` },
    });
  });

  app.use(API_PREFIX, apiLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
