import type { Collection, Db } from "mongodb";

import { getDb } from "../config/db.js";
import type { ApplicationDoc, BookmarkDoc, PaymentDoc, TuitionDoc, UserDoc } from "../types/models.js";

export const COLLECTIONS = {
  users: "users",
  tuitions: "tuitions",
  applications: "applications",
  payments: "payments",
  bookmarks: "bookmarks",
  // Better Auth internal collections (usePlural: true)
  sessions: "sessions",
  accounts: "accounts",
  verifications: "verifications",
} as const;

export const users = (db: Db = getDb()): Collection<UserDoc> => db.collection<UserDoc>(COLLECTIONS.users);
export const tuitions = (db: Db = getDb()): Collection<TuitionDoc> =>
  db.collection<TuitionDoc>(COLLECTIONS.tuitions);
export const applications = (db: Db = getDb()): Collection<ApplicationDoc> =>
  db.collection<ApplicationDoc>(COLLECTIONS.applications);
export const payments = (db: Db = getDb()): Collection<PaymentDoc> =>
  db.collection<PaymentDoc>(COLLECTIONS.payments);
export const bookmarks = (db: Db = getDb()): Collection<BookmarkDoc> =>
  db.collection<BookmarkDoc>(COLLECTIONS.bookmarks);

/**
 * Creates every index the business rules depend on. Uniqueness is enforced by
 * the database, not only by application checks, so concurrent requests cannot
 * produce duplicates.
 */
export async function ensureIndexes(db: Db = getDb()): Promise<void> {
  await Promise.all([
    users(db).createIndexes([
      { key: { email: 1 }, name: "uniq_email", unique: true },
      { key: { role: 1, createdAt: -1 }, name: "role_createdAt" },
    ]),

    tuitions(db).createIndexes([
      { key: { tutorId: 1, createdAt: -1 }, name: "tutor_createdAt" },
      { key: { approvalStatus: 1, isActive: 1, createdAt: -1 }, name: "public_listing" },
      { key: { subject: 1 }, name: "subject" },
      { key: { location: 1 }, name: "location" },
      { key: { monthlyFee: 1 }, name: "monthlyFee" },
    ]),

    applications(db).createIndexes([
      { key: { tuitionId: 1, studentId: 1 }, name: "uniq_tuition_student", unique: true },
      { key: { studentId: 1, appliedAt: -1 }, name: "student_appliedAt" },
      { key: { tutorId: 1, status: 1 }, name: "tutor_status" },
      { key: { tutorId: 1, isPriority: -1, appliedAt: -1 }, name: "tutor_priority" },
    ]),

    payments(db).createIndexes([
      {
        key: { stripeSessionId: 1 },
        name: "uniq_stripeSessionId",
        unique: true,
        partialFilterExpression: { stripeSessionId: { $type: "string" } },
      },
      { key: { userId: 1, createdAt: -1 }, name: "user_createdAt" },
      { key: { status: 1, createdAt: -1 }, name: "status_createdAt" },
    ]),

    bookmarks(db).createIndexes([
      { key: { studentId: 1, tuitionId: 1 }, name: "uniq_student_tuition", unique: true },
      { key: { tuitionId: 1 }, name: "tuition" },
    ]),

    db.collection(COLLECTIONS.sessions).createIndexes([
      { key: { token: 1 }, name: "uniq_token", unique: true },
      { key: { userId: 1 }, name: "userId" },
      { key: { expiresAt: 1 }, name: "expiresAt" },
    ]),

    db.collection(COLLECTIONS.accounts).createIndexes([{ key: { userId: 1 }, name: "userId" }]),
    db.collection(COLLECTIONS.verifications).createIndexes([{ key: { identifier: 1 }, name: "identifier" }]),
  ]);
}
