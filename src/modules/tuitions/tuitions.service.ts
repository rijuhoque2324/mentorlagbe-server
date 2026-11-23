import type { Document, Filter, ObjectId } from "mongodb";

import { FREE_TUTOR_POST_LIMIT } from "../../config/plans.js";
import { applications, bookmarks, COLLECTIONS, tuitions } from "../../db/collections.js";
import type { AuthUser } from "../../types/express.js";
import type { ApprovalStatus, ModerationEvent, TuitionDoc } from "../../types/models.js";
import { AppError } from "../../utils/app-error.js";
import { logger } from "../../utils/logger.js";
import { containsRegex, exactInsensitiveRegex, skipFor, toObjectId } from "../../utils/query.js";
import { buildMeta } from "../../utils/response.js";
import { uploadToImgbb } from "../uploads/uploads.service.js";
import { serializeTuition, type TuitionWithExtras } from "./tuitions.serializer.js";
import {
  SORT_OPTIONS,
  type AdminTuitionsQuery,
  type CreateTuitionInput,
  type ListTuitionsQuery,
  type SortKey,
  type TutorTuitionsQuery,
  type UpdateTuitionInput,
} from "./tuitions.validation.js";

/** Fields whose change sends an approved/rejected post back to moderation. */
const CONTENT_FIELDS = [
  "title",
  "subject",
  "classLevel",
  "mode",
  "location",
  "monthlyFee",
  "daysPerWeek",
  "description",
  "requirements",
  "availability",
] as const;

export const PUBLIC_FILTER: Filter<TuitionDoc> = { approvalStatus: "approved", isActive: true };

function searchFilter(search: string | undefined): Filter<TuitionDoc> {
  if (!search) return {};
  const regex = containsRegex(search);
  return {
    $or: [
      { title: regex },
      { subject: regex },
      { classLevel: regex },
      { location: regex },
      { description: regex },
      { tutorName: regex },
    ],
  };
}

interface QueryPlan {
  filter: Filter<TuitionDoc>;
  sort: SortKey | "featured";
  page: number;
  limit: number;
  withApplicationCount?: boolean;
}

async function runQuery(plan: QueryPlan): Promise<{ items: TuitionWithExtras[]; total: number }> {
  const pipeline: Document[] = [{ $match: plan.filter }];

  if (plan.sort === "featured") {
    pipeline.push(
      {
        $lookup: {
          from: COLLECTIONS.users,
          localField: "tutorId",
          foreignField: "_id",
          as: "tutorDoc",
          pipeline: [{ $project: { name: 1, email: 1, image: 1, plan: 1 } }],
        },
      },
      { $addFields: { tutorIsPro: { $eq: [{ $first: "$tutorDoc.plan" }, "pro"] } } },
      { $sort: { tutorIsPro: -1, createdAt: -1, _id: -1 } },
      { $skip: skipFor(plan.page, plan.limit) },
      { $limit: plan.limit },
      { $project: { tutorIsPro: 0 } },
    );
  } else {
    pipeline.push(
      { $sort: SORT_OPTIONS[plan.sort] },
      { $skip: skipFor(plan.page, plan.limit) },
      { $limit: plan.limit },
      {
        $lookup: {
          from: COLLECTIONS.users,
          localField: "tutorId",
          foreignField: "_id",
          as: "tutorDoc",
          pipeline: [{ $project: { name: 1, email: 1, image: 1, plan: 1 } }],
        },
      },
    );
  }

  if (plan.withApplicationCount) {
    pipeline.push(
      {
        $lookup: {
          from: COLLECTIONS.applications,
          localField: "_id",
          foreignField: "tuitionId",
          as: "applicationStats",
          pipeline: [{ $match: { status: { $ne: "cancelled" } } }, { $count: "count" }],
        },
      },
      { $addFields: { applicationCount: { $ifNull: [{ $first: "$applicationStats.count" }, 0] } } },
      { $project: { applicationStats: 0 } },
    );
  }

  const [items, total] = await Promise.all([
    tuitions().aggregate<TuitionWithExtras>(pipeline).toArray(),
    tuitions().countDocuments(plan.filter),
  ]);

  return { items, total };
}

async function bookmarkedSet(viewer: AuthUser | undefined, ids: ObjectId[]): Promise<Set<string> | undefined> {
  if (!viewer || viewer.role !== "student" || ids.length === 0) {
    return undefined;
  }

  const rows = await bookmarks()
    .find({ studentId: viewer._id, tuitionId: { $in: ids } }, { projection: { tuitionId: 1 } })
    .toArray();

  return new Set(rows.map((row) => row.tuitionId.toHexString()));
}

// ---------------------------------------------------------------- public

export async function listPublicTuitions(query: ListTuitionsQuery, viewer?: AuthUser) {
  const filter: Filter<TuitionDoc> = { ...PUBLIC_FILTER, ...searchFilter(query.search) };

  if (query.subject) filter.subject = exactInsensitiveRegex(query.subject);
  if (query.classLevel) filter.classLevel = exactInsensitiveRegex(query.classLevel);
  if (query.mode) filter.mode = query.mode;
  if (query.location) filter.location = containsRegex(query.location);
  if (query.minFee !== undefined || query.maxFee !== undefined) {
    filter.monthlyFee = {
      ...(query.minFee !== undefined ? { $gte: query.minFee } : {}),
      ...(query.maxFee !== undefined ? { $lte: query.maxFee } : {}),
    };
  }

  const { items, total } = await runQuery({ filter, sort: query.sort, page: query.page, limit: query.limit });
  const bookmarkedIds = await bookmarkedSet(
    viewer,
    items.map((item) => item._id),
  );

  return {
    items: items.map((item) => serializeTuition(item, { bookmarkedIds })),
    meta: buildMeta(query.page, query.limit, total),
  };
}

export async function listFeaturedTuitions(limit: number, viewer?: AuthUser) {
  const { items } = await runQuery({ filter: PUBLIC_FILTER, sort: "featured", page: 1, limit });
  const bookmarkedIds = await bookmarkedSet(
    viewer,
    items.map((item) => item._id),
  );
  return items.map((item) => serializeTuition(item, { bookmarkedIds }));
}

/**
 * Public detail. Approved + active posts are visible to everyone. The owning
 * tutor and admins may also view non-public posts; everyone else gets 404 so
 * the existence of unpublished posts is not leaked.
 */
export async function getTuitionForViewer(id: ObjectId, viewer?: AuthUser) {
  const { items } = await runQuery({
    filter: { _id: id },
    sort: "newest",
    page: 1,
    limit: 1,
    withApplicationCount: true,
  });
  const doc = items[0];

  if (!doc) {
    throw AppError.notFound("Tuition not found");
  }

  const isOwner = Boolean(viewer && doc.tutorId.equals(viewer._id));
  const isAdmin = viewer?.role === "admin";
  const isPublic = doc.approvalStatus === "approved" && doc.isActive;

  if (!isPublic && !isOwner && !isAdmin) {
    throw AppError.notFound("Tuition not found");
  }

  const bookmarkedIds = await bookmarkedSet(viewer, [doc._id]);
  return serializeTuition(doc, { privileged: isOwner || isAdmin, bookmarkedIds });
}

// ---------------------------------------------------------------- tutor

export async function findTuitionById(id: ObjectId): Promise<TuitionDoc | null> {
  return tuitions().findOne({ _id: id });
}

/**
 * Free-plan rule: a qualifying post is any post that currently exists for the
 * tutor, regardless of approval or active status. Deleting a post frees a
 * slot. The count is re-checked after insert so concurrent requests cannot
 * exceed the limit.
 */
async function assertCanCreate(tutor: AuthUser) {
  if (tutor.plan === "pro") return;

  const count = await tuitions().countDocuments({ tutorId: tutor._id });

  if (count >= FREE_TUTOR_POST_LIMIT) {
    throw AppError.conflict(
      `Free tutors can have at most ${FREE_TUTOR_POST_LIMIT} tuition posts. Upgrade to Tutor Pro for unlimited posts.`,
      "PLAN_LIMIT_REACHED",
    );
  }
}

export async function createTuition(tutor: AuthUser, input: CreateTuitionInput) {
  await assertCanCreate(tutor);

  const now = new Date();
  const doc: Omit<TuitionDoc, "_id"> = {
    title: input.title,
    subject: input.subject,
    classLevel: input.classLevel,
    mode: input.mode,
    location: input.location,
    monthlyFee: input.monthlyFee,
    daysPerWeek: input.daysPerWeek,
    description: input.description,
    ...(input.requirements ? { requirements: input.requirements } : {}),
    ...(input.availability ? { availability: input.availability } : {}),
    bannerImage: input.bannerImage ?? null,

    // Identity is always taken from the session, never from the request body.
    tutorId: tutor._id,
    tutorName: tutor.name,
    tutorEmail: tutor.email,

    approvalStatus: "pending",
    isActive: input.isActive,
    rejectionReason: null,
    moderatedBy: null,
    moderatedAt: null,
    moderationHistory: [{ action: "submitted", by: tutor._id, at: now }],

    createdAt: now,
    updatedAt: now,
  };

  const result = await tuitions().insertOne(doc as TuitionDoc);

  if (tutor.plan !== "pro") {
    const count = await tuitions().countDocuments({ tutorId: tutor._id });
    if (count > FREE_TUTOR_POST_LIMIT) {
      await tuitions().deleteOne({ _id: result.insertedId });
      throw AppError.conflict(
        `Free tutors can have at most ${FREE_TUTOR_POST_LIMIT} tuition posts. Upgrade to Tutor Pro for unlimited posts.`,
        "PLAN_LIMIT_REACHED",
      );
    }
  }

  return getOwnedSerialized(result.insertedId);
}

async function getOwnedSerialized(id: ObjectId) {
  const { items } = await runQuery({
    filter: { _id: id },
    sort: "newest",
    page: 1,
    limit: 1,
    withApplicationCount: true,
  });

  if (!items[0]) {
    throw AppError.notFound("Tuition not found");
  }

  return serializeTuition(items[0], { privileged: true });
}

export async function listTutorTuitions(tutor: AuthUser, query: TutorTuitionsQuery) {
  const filter: Filter<TuitionDoc> = { tutorId: tutor._id, ...searchFilter(query.search) };
  if (query.status) filter.approvalStatus = query.status;
  if (query.isActive !== undefined) filter.isActive = query.isActive;

  const { items, total } = await runQuery({
    filter,
    sort: query.sort,
    page: query.page,
    limit: query.limit,
    withApplicationCount: true,
  });

  return {
    items: items.map((item) => serializeTuition(item, { privileged: true })),
    meta: buildMeta(query.page, query.limit, total),
  };
}

/**
 * Updates a tutor's own post. Editing content of an approved or rejected post
 * re-submits it for moderation, so approved content cannot be swapped out
 * after review. Toggling `isActive` alone does not require re-approval.
 */
export async function updateTuition(existing: TuitionDoc, tutor: AuthUser, input: UpdateTuitionInput) {
  const now = new Date();
  const set: Partial<TuitionDoc> = { updatedAt: now };
  const unset: Record<string, ""> = {};

  for (const field of CONTENT_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if ((field === "requirements" || field === "availability") && value === "") {
      unset[field] = "";
    } else {
      (set as Record<string, unknown>)[field] = value;
    }
  }

  if (input.bannerImage !== undefined) set.bannerImage = input.bannerImage;
  if (input.isActive !== undefined) set.isActive = input.isActive;

  const contentChanged = CONTENT_FIELDS.some((field) => {
    const value = input[field];
    if (value === undefined) return false;
    const current = existing[field] ?? "";
    return value !== current;
  });

  const update: Document = { $set: set };

  if (contentChanged && existing.approvalStatus !== "pending") {
    set.approvalStatus = "pending";
    set.rejectionReason = null;
    update.$push = { moderationHistory: { action: "resubmitted", by: tutor._id, at: now } satisfies ModerationEvent };
  }

  if (Object.keys(unset).length > 0) {
    update.$unset = unset;
  }

  const result = await tuitions().updateOne({ _id: existing._id, tutorId: tutor._id }, update);

  if (result.matchedCount === 0) {
    throw AppError.notFound("Tuition not found");
  }

  return getOwnedSerialized(existing._id);
}

export async function setTuitionActive(existing: TuitionDoc, tutor: AuthUser, isActive: boolean) {
  await tuitions().updateOne(
    { _id: existing._id, tutorId: tutor._id },
    { $set: { isActive, updatedAt: new Date() } },
  );
  return getOwnedSerialized(existing._id);
}

export async function updateTuitionBanner(existing: TuitionDoc, file: Express.Multer.File | undefined) {
  const image = await uploadToImgbb(file as Express.Multer.File, `tuition-${existing._id.toHexString()}`);
  await tuitions().updateOne({ _id: existing._id }, { $set: { bannerImage: image.url, updatedAt: new Date() } });
  return getOwnedSerialized(existing._id);
}

/** Hard delete. Related applications and bookmarks are removed as well. */
export async function deleteTuition(existing: TuitionDoc, tutor: AuthUser) {
  const result = await tuitions().deleteOne({ _id: existing._id, tutorId: tutor._id });

  if (result.deletedCount === 0) {
    throw AppError.notFound("Tuition not found");
  }

  const [apps, marks] = await Promise.all([
    applications().deleteMany({ tuitionId: existing._id }),
    bookmarks().deleteMany({ tuitionId: existing._id }),
  ]);

  logger.info("Tuition deleted", {
    tuitionId: existing._id.toHexString(),
    tutorId: tutor.id,
    removedApplications: apps.deletedCount,
    removedBookmarks: marks.deletedCount,
  });
}

// ---------------------------------------------------------------- admin

export async function listAllTuitions(query: AdminTuitionsQuery) {
  const filter: Filter<TuitionDoc> = { ...searchFilter(query.search) };
  if (query.status) filter.approvalStatus = query.status;
  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.tutorId) filter.tutorId = toObjectId(query.tutorId);

  const { items, total } = await runQuery({
    filter,
    sort: query.sort,
    page: query.page,
    limit: query.limit,
    withApplicationCount: true,
  });

  return {
    items: items.map((item) => serializeTuition(item, { privileged: true })),
    meta: buildMeta(query.page, query.limit, total),
  };
}

export async function moderateTuition(
  id: ObjectId,
  admin: AuthUser,
  status: Extract<ApprovalStatus, "approved" | "rejected">,
  reason?: string,
) {
  const existing = await findTuitionById(id);

  if (!existing) {
    throw AppError.notFound("Tuition not found");
  }

  if (existing.approvalStatus === status) {
    throw AppError.conflict(`This tuition is already ${status}`, "INVALID_TRANSITION");
  }

  const now = new Date();
  const event: ModerationEvent = {
    action: status,
    by: admin._id,
    at: now,
    ...(reason ? { reason } : {}),
  };

  // Conditional on the status we read, so two moderators cannot race.
  const result = await tuitions().updateOne(
    { _id: id, approvalStatus: existing.approvalStatus },
    {
      $set: {
        approvalStatus: status,
        rejectionReason: status === "rejected" ? (reason ?? null) : null,
        moderatedBy: admin._id,
        moderatedAt: now,
        updatedAt: now,
      },
      $push: { moderationHistory: event },
    },
  );

  if (result.modifiedCount === 0) {
    throw AppError.conflict("This tuition was modified by someone else. Refresh and try again.", "INVALID_TRANSITION");
  }

  logger.info("Tuition moderated", {
    tuitionId: id.toHexString(),
    adminId: admin.id,
    from: existing.approvalStatus,
    to: status,
  });

  return getOwnedSerialized(id);
}
