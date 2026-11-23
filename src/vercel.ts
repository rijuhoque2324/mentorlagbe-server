import type { IncomingMessage, ServerResponse } from "node:http";

import type { Express } from "express";

import { createApp } from "./app.js";
import { connectDatabase } from "./config/db.js";
import { ensureIndexes } from "./db/collections.js";
import { initAuth } from "./lib/auth.js";
import { logger } from "./utils/logger.js";

/**
 * Serverless entry point (Vercel). The MongoDB connection, indexes, Better
 * Auth instance and Express app are created once per warm function instance
 * and reused across invocations.
 */
let appPromise: Promise<Express> | null = null;

function getApp(): Promise<Express> {
  if (!appPromise) {
    appPromise = (async () => {
      const db = await connectDatabase();
      await ensureIndexes(db);
      return createApp(initAuth(db));
    })().catch((error: unknown) => {
      appPromise = null; // allow the next invocation to retry
      throw error;
    });
  }

  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await getApp();
    app(req as Parameters<Express>[0], res as Parameters<Express>[1]);
  } catch (error) {
    logger.error("Failed to initialise API", { error: error instanceof Error ? error.message : String(error) });
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: false, message: "Service temporarily unavailable", code: "SERVICE_UNAVAILABLE" }));
  }
}
