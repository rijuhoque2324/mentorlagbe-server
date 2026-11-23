import type { ApplicationDoc, TuitionDoc, UserDoc } from "../../types/models.js";

export type ApplicationWithExtras = ApplicationDoc & {
  tuitionDoc?: TuitionDoc[];
  studentDoc?: Pick<UserDoc, "_id" | "name" | "email" | "image" | "plan" | "phone">[];
  tutorDoc?: Pick<UserDoc, "_id" | "name" | "image" | "plan" | "email">[];
};

export type Viewer = "student" | "tutor" | "admin";

/**
 * Contact release policy: the student's phone and the tutor's email are only
 * shared with the other party once the application is accepted. Admins see
 * everything.
 */
export function serializeApplication(doc: ApplicationWithExtras, viewer: Viewer) {
  const tuition = doc.tuitionDoc?.[0];
  const student = doc.studentDoc?.[0];
  const tutor = doc.tutorDoc?.[0];
  const accepted = doc.status === "accepted";
  const showStudentPhone = viewer === "admin" || viewer === "student" || accepted;
  const showTutorEmail = viewer === "admin" || viewer === "tutor" || accepted;

  return {
    id: doc._id.toHexString(),
    tuitionId: doc.tuitionId.toHexString(),
    tuitionTitle: tuition?.title ?? doc.tuitionTitle,
    subject: tuition?.subject ?? doc.subject,
    monthlyFee: tuition?.monthlyFee ?? doc.monthlyFee,

    tutorId: doc.tutorId.toHexString(),
    ...(showTutorEmail ? { tutorEmail: doc.tutorEmail } : {}),

    studentId: doc.studentId.toHexString(),
    studentName: doc.studentName,
    studentEmail: doc.studentEmail,
    ...(showStudentPhone ? { studentPhone: doc.studentPhone || null } : {}),

    preferredSchedule: doc.preferredSchedule || null,
    studentNote: doc.studentNote ?? null,
    message: doc.studentNote ?? null,

    isPriority: doc.isPriority,
    status: doc.status,

    appliedAt: doc.appliedAt,
    createdAt: doc.appliedAt,
    updatedAt: doc.updatedAt,
    decidedAt: doc.decidedAt ?? null,

    tuition: tuition
      ? {
          id: tuition._id.toHexString(),
          title: tuition.title,
          subject: tuition.subject,
          classLevel: tuition.classLevel,
          mode: tuition.mode,
          location: tuition.location,
          monthlyFee: tuition.monthlyFee,
          daysPerWeek: tuition.daysPerWeek,
          description: tuition.description,
          status: tuition.approvalStatus,
          approvalStatus: tuition.approvalStatus,
          isActive: tuition.isActive,
          tutorId: tuition.tutorId.toHexString(),
          tutor: {
            id: tuition.tutorId.toHexString(),
            name: tutor?.name ?? tuition.tutorName,
            image: tutor?.image ?? null,
            verified: tutor?.plan === "pro",
            ...(showTutorEmail ? { email: tutor?.email ?? tuition.tutorEmail } : {}),
          },
        }
      : {
          id: doc.tuitionId.toHexString(),
          title: doc.tuitionTitle,
          subject: doc.subject,
          monthlyFee: doc.monthlyFee,
          tutorId: doc.tutorId.toHexString(),
        },

    student: {
      id: doc.studentId.toHexString(),
      name: student?.name ?? doc.studentName,
      email: student?.email ?? doc.studentEmail,
      image: student?.image ?? null,
      plan: student?.plan === "pro" ? "pro" : "free",
      role: "student",
      ...(showStudentPhone ? { phone: doc.studentPhone || student?.phone || null } : {}),
    },
  };
}
