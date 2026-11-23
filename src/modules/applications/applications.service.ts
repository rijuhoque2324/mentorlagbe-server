import type { Document, Filter, ObjectId } from "mongodb";

import { applications, COLLECTIONS, tuitions } from "../../db/collections.js";
import type { AuthUser } from "../../types/express.js";
import type { ApplicationDoc, ApplicationStatus } from "../../types/models.js";
import { AppError, isDuplicateKeyError } from "../../utils/app-error.js";
import { logger } from "../../utils/logger.js";
import { containsRegex, skipFor, toObjectId } from "../../utils/query.js";
import { buildMeta } from "../../utils/response.js";
import { serializeApplication, type ApplicationWithExtras, type Viewer } from "./applications.serializer.js";
import type { ApplicationListQuery, ApplyInput } from "./applications.validation.js";

const LOOKUPS: Document[] = [
  {
    $lookup: {
      from: COLLECTIONS.tuitions,
      localField: "tuitionId",
      foreignField: "_id",
      as: "tuitionDoc",
      pipeline: [{ $project: { moderationHistory: 0 } }],
    },
  },
  {
    $lookup: {
      from: COLLECTIONS.users,
      localField: "studentId",
      foreignField: "_id",
      as: "studentDoc",
      pipeline: [{ $project: { name: 1, email: 1, image: 1, plan: 1, phone: 1 } }],
    },
  },
  {
    $lookup: {
      from: COLLECTIONS.users,
      localField: "tutorId",
      foreignField: "_id",
      as: "tutorDoc",
      pipeline: [{ $project: { name: 1, email: 1, image: 1, plan: 1 } }],
    },
  },
];

async function loadOne(id: ObjectId): Promise<ApplicationWithExtras | null> {
  const [doc] = await applications()
    .aggregate<ApplicationWithExtras>([{ $match: { _id: id } }, ...LOOKUPS])
    .toArray();
  return doc ?? null;
}

async function loadSerialized(id: ObjectId, viewer: Viewer) {
  const doc = await loadOne(id);
  if (!doc) throw AppError.notFound("Application not found");
  return serializeApplication(doc, viewer);
}

export async function findApplicationById(id: ObjectId): Promise<ApplicationDoc | null> {
  return applications().findOne({ _id: id });
}

/**
 * A student applies to a tuition. Student identity comes from the session;
 * tutor id, title, subject and fee are copied from the stored tuition. The
 * unique `{ tuitionId, studentId }` index rejects concurrent duplicates.
 * A previously cancelled application is re-opened instead of duplicated.
 */
export async function applyToTuition(student: AuthUser, tuitionId: ObjectId, input: ApplyInput) {
  const tuition = await tuitions().findOne({ _id: tuitionId });

  if (!tuition) {
    throw AppError.notFound("Tuition not found");
  }

  if (tuition.approvalStatus !== "approved" || !tuition.isActive) {
    throw AppError.conflict("This tuition is not accepting applications", "TUITION_NOT_OPEN");
  }

  if (tuition.tutorId.equals(student._id)) {
    throw AppError.forbidden("You cannot apply to your own tuition");
  }

  const now = new Date();
  const note = input.studentNote ?? input.message;
  const fields = {
    tuitionTitle: tuition.title,
    subject: tuition.subject,
    monthlyFee: tuition.monthlyFee,
    tutorId: tuition.tutorId,
    tutorEmail: tuition.tutorEmail,
    studentName: student.name,
    studentEmail: student.email,
    studentPhone: input.phone ?? student.phone ?? "",
    preferredSchedule: input.preferredSchedule ?? "",
    isPriority: student.plan === "pro",
    status: "pending" as const,
    decidedAt: null,
    cancelledAt: null,
    updatedAt: now,
  };

  try {
    const result = await applications().insertOne({
      tuitionId: tuition._id,
      studentId: student._id,
      ...fields,
      ...(note ? { studentNote: note } : {}),
      appliedAt: now,
    } as ApplicationDoc);

    return loadSerialized(result.insertedId, "student");
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }

  // Duplicate: allow re-applying only if the previous application was cancelled.
  const reopened = await applications().findOneAndUpdate(
    { tuitionId: tuition._id, studentId: student._id, status: "cancelled" },
    {
      $set: { ...fields, appliedAt: now, ...(note ? { studentNote: note } : {}) },
      ...(note ? {} : { $unset: { studentNote: "" } }),
    },
    { returnDocument: "after" },
  );

  if (!reopened) {
    throw AppError.conflict("You have already applied to this tuition", "ALREADY_APPLIED");
  }

  return loadSerialized(reopened._id, "student");
}

async function list(baseFilter: Filter<ApplicationDoc>, query: ApplicationListQuery, viewer: Viewer) {
  const filter: Filter<ApplicationDoc> = { ...baseFilter };
  if (query.status) filter.status = query.status;
  if (query.tuitionId) filter.tuitionId = toObjectId(query.tuitionId);
  if (query.search) {
    const regex = containsRegex(query.search);
    filter.$or = [{ tuitionTitle: regex }, { subject: regex }, { studentName: regex }, { studentEmail: regex }];
  }

  // Priority booking: Pro students' applications are listed first for tutors.
  const sort: Document = viewer === "tutor" ? { isPriority: -1, appliedAt: -1, _id: -1 } : { appliedAt: -1, _id: -1 };

  const [items, total] = await Promise.all([
    applications()
      .aggregate<ApplicationWithExtras>([
        { $match: filter },
        { $sort: sort },
        { $skip: skipFor(query.page, query.limit) },
        { $limit: query.limit },
        ...LOOKUPS,
      ])
      .toArray(),
    applications().countDocuments(filter),
  ]);

  return {
    items: items.map((item) => serializeApplication(item, viewer)),
    meta: buildMeta(query.page, query.limit, total),
  };
}

export function listStudentApplications(student: AuthUser, query: ApplicationListQuery) {
  return list({ studentId: student._id }, query, "student");
}

/** Only applications for the calling tutor's own posts are ever returned. */
export function listTutorApplications(tutor: AuthUser, query: ApplicationListQuery) {
  return list({ tutorId: tutor._id }, query, "tutor");
}

export async function getApplicationForViewer(doc: ApplicationDoc, viewer: AuthUser) {
  const role: Viewer = viewer.role === "admin" ? "admin" : doc.studentId.equals(viewer._id) ? "student" : "tutor";
  return loadSerialized(doc._id, role);
}

/** Allowed transitions: pending → accepted | rejected | cancelled. Nothing else. */
async function transition(
  doc: ApplicationDoc,
  ownerFilter: Filter<ApplicationDoc>,
  next: Exclude<ApplicationStatus, "pending">,
) {
  if (doc.status !== "pending") {
    throw AppError.conflict(
      `Only pending applications can be ${next}. This application is already ${doc.status}.`,
      "INVALID_TRANSITION",
    );
  }

  const now = new Date();
  const set: Partial<ApplicationDoc> = { status: next, updatedAt: now };
  if (next === "cancelled") set.cancelledAt = now;
  else set.decidedAt = now;

  // Conditional update guards against concurrent transitions.
  const result = await applications().updateOne({ _id: doc._id, status: "pending", ...ownerFilter }, { $set: set });

  if (result.modifiedCount === 0) {
    throw AppError.conflict("This application was already updated. Refresh and try again.", "INVALID_TRANSITION");
  }
}

export async function cancelApplication(doc: ApplicationDoc, student: AuthUser) {
  await transition(doc, { studentId: student._id }, "cancelled");
  return loadSerialized(doc._id, "student");
}

export async function decideApplication(doc: ApplicationDoc, tutor: AuthUser, status: "accepted" | "rejected") {
  await transition(doc, { tutorId: tutor._id }, status);
  logger.info("Application decided", {
    applicationId: doc._id.toHexString(),
    tutorId: tutor.id,
    status,
  });
  return loadSerialized(doc._id, "tutor");
}
