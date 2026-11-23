import type { UserDoc } from "../../types/models.js";

/** Safe public projection of a user. Never includes auth/internal fields. */
export function serializeUser(doc: UserDoc, options: { includeHistory?: boolean } = {}) {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    email: doc.email,
    emailVerified: Boolean(doc.emailVerified),
    image: doc.image ?? null,
    phone: doc.phone ?? null,
    bio: doc.bio ?? null,
    location: doc.location ?? null,
    role: doc.role,
    plan: doc.plan === "pro" ? "pro" : "free",
    planActivatedAt: doc.planActivatedAt ?? null,
    verified: doc.role === "tutor" && doc.plan === "pro",
    profileCompleted: Boolean(doc.profileCompleted),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    ...(options.includeHistory
      ? {
          roleHistory: (doc.roleHistory ?? []).map((entry) => ({
            from: entry.from,
            to: entry.to,
            changedBy: entry.changedBy.toHexString(),
            changedAt: entry.changedAt,
          })),
        }
      : {}),
  };
}

export const SAFE_USER_PROJECTION = {
  _id: 1,
  name: 1,
  email: 1,
  emailVerified: 1,
  image: 1,
  phone: 1,
  bio: 1,
  location: 1,
  role: 1,
  plan: 1,
  planActivatedAt: 1,
  profileCompleted: 1,
  roleHistory: 1,
  createdAt: 1,
  updatedAt: 1,
} as const;
