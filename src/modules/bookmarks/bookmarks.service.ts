import type { ObjectId } from "mongodb";

import { FREE_STUDENT_BOOKMARK_LIMIT } from "../../config/plans.js";
import { bookmarks, COLLECTIONS, tuitions } from "../../db/collections.js";
import type { AuthUser } from "../../types/express.js";
import type { BookmarkDoc, TuitionDoc } from "../../types/models.js";
import { AppError, isDuplicateKeyError } from "../../utils/app-error.js";
import { skipFor } from "../../utils/query.js";
import { buildMeta } from "../../utils/response.js";
import { serializeTuition, type TuitionWithExtras } from "../tuitions/tuitions.serializer.js";

type BookmarkWithTuition = BookmarkDoc & { tuitionDoc: TuitionWithExtras[] };

function limitError() {
  return AppError.conflict(
    `Free students can save up to ${FREE_STUDENT_BOOKMARK_LIMIT} bookmarks. Upgrade to Student Pro for unlimited bookmarks.`,
    "PLAN_LIMIT_REACHED",
  );
}

function serialize(doc: BookmarkWithTuition) {
  const tuition = doc.tuitionDoc[0];
  return {
    id: doc._id.toHexString(),
    tuitionId: doc.tuitionId.toHexString(),
    createdAt: doc.createdAt,
    tuition: tuition ? serializeTuition(tuition, { bookmarkedIds: new Set([tuition._id.toHexString()]) }) : null,
    isAvailable: Boolean(tuition && tuition.approvalStatus === "approved" && tuition.isActive),
  };
}

async function loadMany(filter: Partial<BookmarkDoc>, page: number, limit: number) {
  return bookmarks()
    .aggregate<BookmarkWithTuition>([
      { $match: filter },
      { $sort: { createdAt: -1, _id: -1 } },
      { $skip: skipFor(page, limit) },
      { $limit: limit },
      {
        $lookup: {
          from: COLLECTIONS.tuitions,
          localField: "tuitionId",
          foreignField: "_id",
          as: "tuitionDoc",
          pipeline: [
            { $project: { moderationHistory: 0 } },
            {
              $lookup: {
                from: COLLECTIONS.users,
                localField: "tutorId",
                foreignField: "_id",
                as: "tutorDoc",
                pipeline: [{ $project: { name: 1, image: 1, plan: 1 } }],
              },
            },
          ],
        },
      },
    ])
    .toArray();
}

export async function listBookmarks(student: AuthUser, page: number, limit: number) {
  const filter = { studentId: student._id };
  const [items, total] = await Promise.all([loadMany(filter, page, limit), bookmarks().countDocuments(filter)]);

  return {
    items: items.map(serialize),
    meta: buildMeta(page, limit, total),
    limit: student.plan === "pro" ? null : FREE_STUDENT_BOOKMARK_LIMIT,
  };
}

/**
 * Adds a bookmark. Only approved + active tuitions are eligible. Free students
 * are limited to five; the count is re-checked after insert so concurrent
 * requests cannot exceed the limit.
 */
export async function addBookmark(student: AuthUser, tuitionId: ObjectId) {
  const tuition: TuitionDoc | null = await tuitions().findOne({ _id: tuitionId });

  if (!tuition || tuition.approvalStatus !== "approved" || !tuition.isActive) {
    throw AppError.notFound("Tuition not found or not available for bookmarking");
  }

  const isPro = student.plan === "pro";

  if (!isPro) {
    const count = await bookmarks().countDocuments({ studentId: student._id });
    if (count >= FREE_STUDENT_BOOKMARK_LIMIT) throw limitError();
  }

  let insertedId: ObjectId;

  try {
    const result = await bookmarks().insertOne({
      studentId: student._id,
      tuitionId,
      createdAt: new Date(),
    } as BookmarkDoc);
    insertedId = result.insertedId;
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw AppError.conflict("This tuition is already bookmarked", "ALREADY_BOOKMARKED");
    }
    throw error;
  }

  if (!isPro) {
    const count = await bookmarks().countDocuments({ studentId: student._id });
    if (count > FREE_STUDENT_BOOKMARK_LIMIT) {
      await bookmarks().deleteOne({ _id: insertedId });
      throw limitError();
    }
  }

  const [doc] = await loadMany({ _id: insertedId }, 1, 1);
  return serialize(doc!);
}

/** Removes by bookmark id or tuition id; always scoped to the caller. */
export async function removeBookmark(student: AuthUser, id: ObjectId) {
  const result = await bookmarks().deleteOne({
    studentId: student._id,
    $or: [{ _id: id }, { tuitionId: id }],
  });

  if (result.deletedCount === 0) {
    throw AppError.notFound("Bookmark not found");
  }
}

export async function removeBookmarkByTuition(student: AuthUser, tuitionId: ObjectId) {
  const result = await bookmarks().deleteOne({ studentId: student._id, tuitionId });

  if (result.deletedCount === 0) {
    throw AppError.notFound("Bookmark not found");
  }
}
