import type { Filter, ObjectId } from "mongodb";

import { applications, bookmarks, payments, tuitions, users } from "../../db/collections.js";
import type { AuthUser } from "../../types/express.js";
import type { UserDoc, UserRole } from "../../types/models.js";
import { AppError } from "../../utils/app-error.js";
import { logger } from "../../utils/logger.js";
import { containsRegex, skipFor } from "../../utils/query.js";
import { buildMeta } from "../../utils/response.js";
import { SAFE_USER_PROJECTION, serializeUser } from "../users/users.serializer.js";

function countsBy<T extends string>(rows: Array<{ _id: T | null; count: number }>): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  for (const row of rows) {
    if (row._id) out[row._id] = row.count;
  }
  return out;
}

export async function getDashboardStats() {
  const [roleRows, planRows, approvalRows, activeCount, appRows, paymentRows, revenueRows, tuitionTotal] =
    await Promise.all([
      users()
        .aggregate<{ _id: UserRole; count: number }>([{ $group: { _id: "$role", count: { $sum: 1 } } }])
        .toArray(),
      users()
        .aggregate<{ _id: "free" | "pro"; count: number }>([{ $group: { _id: "$plan", count: { $sum: 1 } } }])
        .toArray(),
      tuitions()
        .aggregate<{ _id: string; count: number }>([{ $group: { _id: "$approvalStatus", count: { $sum: 1 } } }])
        .toArray(),
      tuitions().countDocuments({ approvalStatus: "approved", isActive: true }),
      applications()
        .aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }])
        .toArray(),
      payments()
        .aggregate<{ _id: string; count: number }>([{ $group: { _id: "$status", count: { $sum: 1 } } }])
        .toArray(),
      payments()
        .aggregate<{ _id: string; revenue: number }>([
          { $match: { status: "paid", isDemo: { $ne: true } } },
          { $group: { _id: { $toUpper: "$currency" }, revenue: { $sum: "$amount" } } },
        ])
        .toArray(),
      tuitions().countDocuments({}),
    ]);

  const roles = countsBy(roleRows);
  const plans = countsBy(planRows);
  const approvals = countsBy(approvalRows as Array<{ _id: "pending" | "approved" | "rejected"; count: number }>);
  const apps = countsBy(appRows as Array<{ _id: "pending" | "accepted" | "rejected" | "cancelled"; count: number }>);
  const pays = countsBy(paymentRows as Array<{ _id: "pending" | "paid" | "failed" | "cancelled"; count: number }>);
  const primaryRevenue = revenueRows[0];

  return {
    users: {
      total: (roles.student ?? 0) + (roles.tutor ?? 0) + (roles.admin ?? 0),
      students: roles.student ?? 0,
      tutors: roles.tutor ?? 0,
      admins: roles.admin ?? 0,
      pro: plans.pro ?? 0,
      free: plans.free ?? 0,
    },
    tuitions: {
      total: tuitionTotal,
      pending: approvals.pending ?? 0,
      approved: approvals.approved ?? 0,
      rejected: approvals.rejected ?? 0,
      active: activeCount,
    },
    applications: {
      total: Object.values(apps).reduce((sum, value) => sum + (value ?? 0), 0),
      pending: apps.pending ?? 0,
      accepted: apps.accepted ?? 0,
      rejected: apps.rejected ?? 0,
      cancelled: apps.cancelled ?? 0,
    },
    transactions: {
      total: Object.values(pays).reduce((sum, value) => sum + (value ?? 0), 0),
      paid: pays.paid ?? 0,
      pending: pays.pending ?? 0,
      failed: pays.failed ?? 0,
      cancelled: pays.cancelled ?? 0,
      revenue: primaryRevenue?.revenue ?? 0,
      currency: primaryRevenue?._id ?? "USD",
      revenueByCurrency: Object.fromEntries(revenueRows.map((row) => [row._id, row.revenue])),
    },
  };
}

export async function listUsers(query: {
  search?: string | undefined;
  role?: UserRole | undefined;
  plan?: "free" | "pro" | undefined;
  page: number;
  limit: number;
}) {
  const filter: Filter<UserDoc> = {};
  if (query.role) filter.role = query.role;
  if (query.plan) filter.plan = query.plan;
  if (query.search) {
    const regex = containsRegex(query.search);
    filter.$or = [{ name: regex }, { email: regex }, { phone: regex }];
  }

  const [items, total] = await Promise.all([
    users()
      .find(filter, { projection: SAFE_USER_PROJECTION })
      .sort({ createdAt: -1, _id: -1 })
      .skip(skipFor(query.page, query.limit))
      .limit(query.limit)
      .toArray(),
    users().countDocuments(filter),
  ]);

  return { items: items.map((doc) => serializeUser(doc)), meta: buildMeta(query.page, query.limit, total) };
}

export async function getUserDetails(id: ObjectId) {
  const doc = await users().findOne({ _id: id }, { projection: SAFE_USER_PROJECTION });

  if (!doc) {
    throw AppError.notFound("User not found");
  }

  const [tuitionCount, applicationCount, bookmarkCount, paymentCount] = await Promise.all([
    tuitions().countDocuments({ tutorId: id }),
    applications().countDocuments({ $or: [{ studentId: id }, { tutorId: id }] }),
    bookmarks().countDocuments({ studentId: id }),
    payments().countDocuments({ userId: id }),
  ]);

  return {
    ...serializeUser(doc, { includeHistory: true }),
    stats: { tuitions: tuitionCount, applications: applicationCount, bookmarks: bookmarkCount, payments: paymentCount },
  };
}

/**
 * Changes a user's role. Safeguards: admins cannot change their own role, and
 * the last remaining admin can never be demoted. Each change is appended to
 * the user's `roleHistory` and logged for auditability.
 */
export async function changeUserRole(admin: AuthUser, targetId: ObjectId, role: UserRole) {
  if (admin._id.equals(targetId)) {
    throw AppError.forbidden("You cannot change your own role", "SELF_ROLE_CHANGE");
  }

  const target = await users().findOne({ _id: targetId });

  if (!target) {
    throw AppError.notFound("User not found");
  }

  if (target.role === role) {
    throw AppError.conflict(`User is already a ${role}`, "NO_CHANGE");
  }

  if (target.role === "admin") {
    const adminCount = await users().countDocuments({ role: "admin" });
    if (adminCount <= 1) {
      throw AppError.conflict("The last admin cannot be demoted", "LAST_ADMIN");
    }
  }

  const now = new Date();
  const updated = await users().findOneAndUpdate(
    { _id: targetId, role: target.role },
    {
      $set: { role, updatedAt: now },
      $push: { roleHistory: { from: target.role, to: role, changedBy: admin._id, changedAt: now } },
    },
    { returnDocument: "after", projection: SAFE_USER_PROJECTION },
  );

  if (!updated) {
    throw AppError.conflict("The user was modified concurrently. Refresh and try again.", "CONFLICT");
  }

  // Two admins demoting each other concurrently could both pass the pre-check.
  // Re-verify after the write and roll back if no admin would remain.
  if (target.role === "admin" && (await users().countDocuments({ role: "admin" })) === 0) {
    await users().updateOne(
      { _id: targetId, role },
      { $set: { role: "admin", updatedAt: new Date() }, $pop: { roleHistory: 1 } },
    );
    throw AppError.conflict("The last admin cannot be demoted", "LAST_ADMIN");
  }

  logger.info("User role changed", {
    adminId: admin.id,
    targetId: targetId.toHexString(),
    from: target.role,
    to: role,
  });

  return serializeUser(updated, { includeHistory: true });
}
