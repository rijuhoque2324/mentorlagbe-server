import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovedTuition, setupTestApp, signUp, type TestContext } from "./helpers/setup.js";

let ctx: TestContext;
let fetchMock: ReturnType<typeof vi.fn>;

// Minimal valid PNG header + padding.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

beforeAll(async () => {
  ctx = await setupTestApp();
  const { setImageFetcher } = await import("../src/modules/uploads/uploads.service.js");
  fetchMock = vi.fn();
  setImageFetcher(fetchMock as unknown as typeof fetch);
});

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        data: {
          url: "https://i.ibb.co/abc/photo.png",
          display_url: "https://i.ibb.co/abc/photo.png",
          width: 10,
          height: 10,
        },
        success: true,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
});

afterAll(async () => {
  await ctx?.close();
});

describe("image uploads", () => {
  it("requires authentication", async () => {
    const res = await request(ctx.app).post("/api/v1/uploads/image").attach("image", PNG, "a.png");
    expect(res.status).toBe(401);
  });

  it("uploads a valid image and returns the hosted URL", async () => {
    const user = await signUp(ctx, "student");
    const res = await user.agent.post("/api/v1/uploads/image").attach("image", PNG, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.data.url).toBe("https://i.ibb.co/abc/photo.png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain("api.imgbb.com");
  });

  it("rejects disallowed MIME types", async () => {
    const user = await signUp(ctx, "student");
    const res = await user.agent
      .post("/api/v1/uploads/image")
      .attach("image", Buffer.from("plain text"), { filename: "a.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects files whose content is not really an image", async () => {
    const user = await signUp(ctx, "student");
    const fake = Buffer.from("<script>alert(1)</script>".padEnd(80, " "));
    const res = await user.agent.post("/api/v1/uploads/image").attach("image", fake, { filename: "evil.png", contentType: "image/png" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("rejects files that are too large", async () => {
    const user = await signUp(ctx, "student");
    const big = Buffer.concat([PNG, Buffer.alloc(3 * 1024 * 1024)]);
    const res = await user.agent.post("/api/v1/uploads/image").attach("image", big, { filename: "big.png", contentType: "image/png" });
    expect(res.status).toBe(413);
  });

  it("maps provider failures to 502", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "bad" }), { status: 400 }));
    const user = await signUp(ctx, "student");
    const res = await user.agent.post("/api/v1/uploads/image").attach("image", PNG, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(502);
  });

  it("maps provider timeouts to 502", async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
    const user = await signUp(ctx, "student");
    const res = await user.agent.post("/api/v1/uploads/image").attach("image", PNG, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(502);
    expect(res.body.message).toMatch(/timed out/);
  });

  it("sets the profile avatar", async () => {
    const user = await signUp(ctx, "tutor");
    const res = await user.agent.post("/api/v1/users/me/avatar").attach("image", PNG, { filename: "a.png", contentType: "image/png" });
    expect(res.status).toBe(200);
    expect(res.body.data.image).toBe("https://i.ibb.co/abc/photo.png");
  });

  it("only the owning tutor can set a tuition banner", async () => {
    const owner = await signUp(ctx, "tutor");
    const other = await signUp(ctx, "tutor");
    const id = await createApprovedTuition(ctx, owner);
    const attach = { filename: "a.png", contentType: "image/png" };

    expect((await other.agent.post(`/api/v1/tuitions/${id}/banner`).attach("image", PNG, attach)).status).toBe(403);
    const res = await owner.agent.post(`/api/v1/tuitions/${id}/banner`).attach("image", PNG, attach);
    expect(res.status).toBe(200);
    expect(res.body.data.bannerImage).toBe("https://i.ibb.co/abc/photo.png");
  });

  it("only accepts hosted image URLs in tuition JSON", async () => {
    const owner = await signUp(ctx, "tutor");
    const id = await createApprovedTuition(ctx, owner);
    const res = await owner.agent.patch(`/api/v1/tuitions/${id}`).send({ bannerImage: "javascript:alert(1)" });
    expect(res.status).toBe(400);
  });
});
