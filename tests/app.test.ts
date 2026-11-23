import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_ORIGIN, setupTestApp, type TestContext } from "./helpers/setup.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx?.close();
});

describe("app", () => {
  it("reports health with database status", async () => {
    const res = await request(ctx.app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "ok", database: "up" });
    expect(res.headers["x-request-id"]).toBeDefined();
  });

  it("returns a consistent 404 for unknown routes", async () => {
    const res = await request(ctx.app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, code: "ROUTE_NOT_FOUND", errors: null });
  });

  it("returns 400 for malformed JSON", async () => {
    const res = await request(ctx.app)
      .post("/api/v1/applications")
      .set("Content-Type", "application/json")
      .send('{"broken": ');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MALFORMED_JSON");
  });

  it("sets security headers", async () => {
    const res = await request(ctx.app).get("/api/v1/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("allows credentialed CORS for the client origin only", async () => {
    const allowed = await request(ctx.app).options("/api/v1/tuitions").set("Origin", CLIENT_ORIGIN).set("Access-Control-Request-Method", "GET");
    expect(allowed.headers["access-control-allow-origin"]).toBe(CLIENT_ORIGIN);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const denied = await request(ctx.app).options("/api/v1/tuitions").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not leak internals in 500 responses", async () => {
    const { errorHandler } = await import("../src/middlewares/error-handler.js");
    const { requestContext } = await import("../src/middlewares/request-context.js");
    const app = express();
    app.use(requestContext);
    app.get("/boom", () => {
      throw new Error("db password is hunter2");
    });
    app.use(errorHandler);

    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("hunter2");
    expect(res.body).not.toHaveProperty("stack");
    expect(res.body.code).toBe("INTERNAL_ERROR");
  });

  it("rejects oversized JSON bodies", async () => {
    const res = await request(ctx.app)
      .post("/api/v1/applications")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ blob: "x".repeat(200_000) }));
    expect(res.status).toBe(413);
  });
});

describe("database connection", () => {
  it("fails fast with a clear error for an unreachable server", async () => {
    const { MongoClient } = await import("mongodb");
    const client = new MongoClient("mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=500");
    await expect(client.connect()).rejects.toThrow();
    await client.close();
  });
});
