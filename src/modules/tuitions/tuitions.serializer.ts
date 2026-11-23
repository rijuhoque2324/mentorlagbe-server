import type { ObjectId } from "mongodb";

import type { TuitionDoc, UserDoc } from "../../types/models.js";

export type TuitionWithExtras = TuitionDoc & {
  tutorDoc?: Pick<UserDoc, "_id" | "name" | "email" | "image" | "plan">[];
  applicationCount?: number;
};

export interface SerializeOptions {
  /** Owner tutor or admin: exposes moderation and contact details. */
  privileged?: boolean;
  bookmarkedIds?: Set<string>;
}

export function serializeTuition(doc: TuitionWithExtras, options: SerializeOptions = {}) {
  const tutor = doc.tutorDoc?.[0];
  const id = doc._id.toHexString();

  return {
    id,
    title: doc.title,
    subject: doc.subject,
    classLevel: doc.classLevel,
    mode: doc.mode,
    location: doc.location,
    monthlyFee: doc.monthlyFee,
    daysPerWeek: doc.daysPerWeek,
    description: doc.description,
    requirements: doc.requirements ?? null,
    availability: doc.availability ?? null,
    bannerImage: doc.bannerImage ?? null,

    tutorId: doc.tutorId.toHexString(),
    tutorName: tutor?.name ?? doc.tutorName,
    tutor: {
      id: doc.tutorId.toHexString(),
      name: tutor?.name ?? doc.tutorName,
      image: tutor?.image ?? null,
      verified: tutor?.plan === "pro",
      ...(options.privileged ? { email: tutor?.email ?? doc.tutorEmail } : {}),
    },

    approvalStatus: doc.approvalStatus,
    status: doc.approvalStatus,
    isActive: doc.isActive,
    isPubliclyVisible: doc.approvalStatus === "approved" && doc.isActive,

    ...(options.privileged
      ? {
          tutorEmail: doc.tutorEmail,
          rejectionReason: doc.rejectionReason ?? null,
          moderatedAt: doc.moderatedAt ?? null,
          applicationCount: doc.applicationCount ?? 0,
        }
      : {}),

    ...(options.bookmarkedIds ? { isBookmarked: options.bookmarkedIds.has(id) } : {}),

    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export function moderationHistoryOf(doc: TuitionDoc) {
  return (doc.moderationHistory ?? []).map((entry) => ({
    action: entry.action,
    by: (entry.by as ObjectId).toHexString(),
    reason: entry.reason ?? null,
    at: entry.at,
  }));
}
