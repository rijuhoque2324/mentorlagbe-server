import type { ObjectId } from "mongodb";

export type UserRole = "student" | "tutor" | "admin";
export type PlanTier = "free" | "pro";
export type TuitionMode = "online" | "offline" | "hybrid";
export type ApprovalStatus = "pending" | "approved" | "rejected";
export type ApplicationStatus = "pending" | "accepted" | "rejected" | "cancelled";
export type PaymentStatus = "pending" | "paid" | "failed" | "cancelled";

export const USER_ROLES: readonly UserRole[] = ["student", "tutor", "admin"];
export const PUBLIC_ROLES = ["student", "tutor"] as const;
export const TUITION_MODES: readonly TuitionMode[] = ["online", "offline", "hybrid"];

export interface RoleChange {
  from: UserRole;
  to: UserRole;
  changedBy: ObjectId;
  changedAt: Date;
}

/**
 * Business user document. This is the same document Better Auth stores in the
 * `users` collection (Better Auth is configured with `usePlural: true`), so
 * identity and business profile never diverge. Credentials live in Better
 * Auth's `accounts` collection and are never read by business code.
 */
export interface UserDoc {
  _id: ObjectId;
  name: string;
  email: string;
  emailVerified?: boolean;
  image?: string | null;
  phone?: string | null;
  bio?: string | null;
  location?: string | null;

  role: UserRole;
  plan: PlanTier;
  planActivatedAt?: Date | null;

  profileCompleted?: boolean;
  roleHistory?: RoleChange[];

  createdAt: Date;
  updatedAt: Date;
}

export interface ModerationEvent {
  action: "submitted" | "resubmitted" | "approved" | "rejected";
  by: ObjectId;
  reason?: string;
  at: Date;
}

export interface TuitionDoc {
  _id: ObjectId;

  title: string;
  subject: string;
  classLevel: string;

  mode: TuitionMode;
  location: string;

  monthlyFee: number;
  daysPerWeek: number;

  description: string;
  requirements?: string;
  availability?: string;
  bannerImage?: string | null;

  tutorId: ObjectId;
  tutorName: string;
  tutorEmail: string;

  approvalStatus: ApprovalStatus;
  isActive: boolean;
  rejectionReason?: string | null;
  moderatedBy?: ObjectId | null;
  moderatedAt?: Date | null;
  moderationHistory: ModerationEvent[];

  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationDoc {
  _id: ObjectId;

  tuitionId: ObjectId;
  tuitionTitle: string;
  subject: string;
  monthlyFee: number;

  tutorId: ObjectId;
  tutorEmail: string;

  studentId: ObjectId;
  studentName: string;
  studentEmail: string;
  studentPhone: string;

  preferredSchedule: string;
  studentNote?: string;

  /** Priority booking: set when the applicant was on Student Pro at apply time. */
  isPriority: boolean;

  status: ApplicationStatus;
  decidedAt?: Date | null;
  cancelledAt?: Date | null;

  appliedAt: Date;
  updatedAt: Date;
}

export interface BookmarkDoc {
  _id: ObjectId;
  studentId: ObjectId;
  tuitionId: ObjectId;
  createdAt: Date;
}

export interface PaymentDoc {
  _id: ObjectId;

  userId: ObjectId;
  userEmail: string;
  /** Snapshot of the purchaser's name/role at checkout time. */
  userName?: string;
  userRole?: "student" | "tutor";

  role: "student" | "tutor";
  plan: "student_pro" | "tutor_pro";
  /** Human-readable plan name, e.g. "Student Pro". */
  planName?: string;
  /** Stripe PaymentIntent id once paid (the transaction reference). */
  transactionId?: string | null;
  /** Mirrors `status` under the field name used by the data design. */
  paymentStatus?: PaymentStatus;

  /** Major currency units (e.g. 10 = $10.00). */
  amount: number;
  currency: string;

  stripeSessionId: string | null;
  stripePaymentIntentId?: string | null;

  status: PaymentStatus;
  failureReason?: string | null;
  paidAt?: Date | null;

  /** Stripe event ids already applied to this payment (webhook idempotency). */
  processedEventIds: string[];

  /** Demo/seed records are never real charges. */
  isDemo?: boolean;

  createdAt: Date;
  updatedAt: Date;
}
