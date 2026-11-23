import { Router } from "express";
import { z } from "zod";

import { authenticate, requireUser } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { body, params, query, validate } from "../../middlewares/validate.js";
import { objectIdString, paginationSchema, toObjectId } from "../../utils/query.js";
import { sendCreated, sendSuccess } from "../../utils/response.js";
import { addBookmark, listBookmarks, removeBookmark, removeBookmarkByTuition } from "./bookmarks.service.js";

export const bookmarksRouter = Router();

bookmarksRouter.use(authenticate, authorize("student"));

const listQuery = z.object({
  page: paginationSchema.page,
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const tuitionParam = z.object({ tuitionId: objectIdString });
const idParam = z.object({ id: objectIdString });
const addBody = z.object({ tuitionId: objectIdString });

bookmarksRouter.get("/", validate({ query: listQuery }), async (req, res) => {
  const { page, limit } = query<{ page: number; limit: number }>(req);
  const result = await listBookmarks(requireUser(req), page, limit);
  res.status(200).json({
    success: true,
    message: "Bookmarks loaded",
    data: result.items,
    meta: { ...result.meta, bookmarkLimit: result.limit },
  });
});

// POST /bookmarks  { tuitionId }
bookmarksRouter.post("/", validate({ body: addBody }), async (req, res) => {
  const { tuitionId } = body<{ tuitionId: string }>(req);
  sendCreated(res, await addBookmark(requireUser(req), toObjectId(tuitionId)), "Tuition bookmarked");
});

// POST /bookmarks/:tuitionId
bookmarksRouter.post("/:tuitionId", validate({ params: tuitionParam }), async (req, res) => {
  const { tuitionId } = params<{ tuitionId: string }>(req);
  sendCreated(res, await addBookmark(requireUser(req), toObjectId(tuitionId)), "Tuition bookmarked");
});

// DELETE /bookmarks/tuition/:tuitionId
bookmarksRouter.delete("/tuition/:tuitionId", validate({ params: tuitionParam }), async (req, res) => {
  const { tuitionId } = params<{ tuitionId: string }>(req);
  await removeBookmarkByTuition(requireUser(req), toObjectId(tuitionId));
  sendSuccess(res, null, "Bookmark removed");
});

// DELETE /bookmarks/:id — accepts either a bookmark id or a tuition id.
bookmarksRouter.delete("/:id", validate({ params: idParam }), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  await removeBookmark(requireUser(req), toObjectId(id));
  sendSuccess(res, null, "Bookmark removed");
});
