import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CLIENT_ORIGIN, setupTestApp, signUp, type TestContext } from "./helpers/setup.js";

let ctx: TestContext;

beforeAll(async () => {
  ctx = await setupTestApp();
});

afterAll(async () => {
  await ctx.close();
});

describe("PATCH /api/v1/users/me — profile photo by URL", () => {
  it("accepts an https image URL alongside name, phone and bio", async () => {
    const student = await signUp(ctx, "student");
    const res = await student.agent
      .patch("/api/v1/users/me")
      .set("Origin", CLIENT_ORIGIN)
      .send({ name: "Updated Name", phone: "+8801711111111", bio: "Hi", image: "https://example.com/me.png" });

    expect(res.status).toBe(200);
    const user = res.body.data.user ?? res.body.data;
    expect(user.image).toBe("https://example.com/me.png");
    expect(user.name).toBe("Updated Name");
  });

  it("rejects non-https image URLs", async () => {
    const student = await signUp(ctx, "student");
    const res = await student.agent
      .patch("/api/v1/users/me")
      .set("Origin", CLIENT_ORIGIN)
      .send({ image: "javascript:alert(1)" });

    expect(res.status).toBe(400);
  });
});
