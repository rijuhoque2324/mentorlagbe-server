import type { ApplicationDoc, TuitionDoc, UserDoc } from "../../types/models.js";

export type ApplicationWithExtras = ApplicationDoc & {
  tuitionDoc?: TuitionDoc[];
  studentDoc?: Pick<UserDoc, "_id" | "name" | "email" | "image" | "plan" | "phone">[];
  tutorDoc?: Pick<UserDoc, "_id" | "name" | "image" | "plan" | "email">[];
};

export type Viewer = "student" | "tutor" | "admin";

/**
 * Contact sharing: an application is only ever returned to the student who
 * submitted it, the tutor who owns the tuition post, or an admin (enforced by
 * the routes/queries). Those parties see each other's contact details, so the
 * student's "My Applications" shows the tutor's name and email and the tutor's
 * "Manage Applicants" shows the student's phone.
 */
export function serializeApplication(doc: ApplicationWithExtras, _viewer: Viewer) {
  const tuition = doc.tuitionDoc?.[0];
  const student = doc.studentDoc?.[0];
  const tutor = doc.tutorDoc?.[0];
  const showStudentPhone = true;
  const showTutorEmail = true;

  return {
    id: doc._id.toHexString(),
    tuitionId: doc.tuitionId.toHexString(),
    tuitionTitle: tuition?.title ?? doc.tuitionTitle,
    subject: tuition?.subject ?? doc.subject,
    monthlyFee: tuition?.monthlyFee ?? doc.monthlyFee,

    tutorId: doc.tutorId.toHexString(),
    tutorName: tutor?.name ?? tuition?.tutorName ?? null,
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
