/**
 * Development seed data.
 *
 *   npm run seed            # add demo data (skips users that already exist)
 *   npm run seed -- --reset # wipe the database first (development only)
 *
 * Demo password: taken from SEED_DEMO_PASSWORD, otherwise generated randomly
 * and printed once. There is no publicly known default password. The script
 * refuses to run when NODE_ENV=production.
 */
import type { ObjectId } from "mongodb";

import { env } from "../src/config/env.js";
import { applications, payments, tuitions } from "../src/db/collections.js";
import type { ApplicationDoc, PaymentDoc, TuitionDoc, TuitionMode } from "../src/types/models.js";
import { bootstrap, ensureUser, generatePassword, hasFlag } from "./lib.js";

interface SeedTuition {
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
}

const TUITIONS: SeedTuition[] = [
  { title: "HSC Physics full syllabus", subject: "Physics", classLevel: "HSC", mode: "offline", location: "Dhanmondi, Dhaka", monthlyFee: 6000, daysPerWeek: 3, description: "Complete HSC physics syllabus with weekly problem-solving and board question practice.", availability: "Evenings after 6pm" },
  { title: "SSC Higher Math crash course", subject: "Mathematics", classLevel: "SSC", mode: "online", location: "Online", monthlyFee: 4000, daysPerWeek: 4, description: "Intensive higher math preparation focused on algebra, geometry and trigonometry for SSC." },
  { title: "Class 8 English grammar & writing", subject: "English", classLevel: "Class 6-8", mode: "offline", location: "Mirpur 10, Dhaka", monthlyFee: 3000, daysPerWeek: 3, description: "Grammar foundations, paragraph writing and comprehension practice for class 8 students." },
  { title: "HSC Chemistry organic focus", subject: "Chemistry", classLevel: "HSC", mode: "hybrid", location: "Uttara, Dhaka", monthlyFee: 6500, daysPerWeek: 3, description: "Organic chemistry deep-dive with reaction mechanisms, plus inorganic revision sessions.", requirements: "Students must bring their own textbooks." },
  { title: "University admission Biology", subject: "Biology", classLevel: "Admission", mode: "online", location: "Online", monthlyFee: 7000, daysPerWeek: 5, description: "Medical admission biology preparation with daily MCQ drills and mock tests." },
  { title: "Class 5 general science and math", subject: "General Science", classLevel: "Class 1-5", mode: "offline", location: "Mohammadpur, Dhaka", monthlyFee: 2500, daysPerWeek: 4, description: "Friendly home tutoring covering science and mathematics for primary students." },
  { title: "ICT for HSC practical and theory", subject: "ICT", classLevel: "HSC", mode: "online", location: "Online", monthlyFee: 3500, daysPerWeek: 2, description: "HTML, C programming basics, number systems and database chapters for HSC ICT." },
  { title: "Accounting for HSC Business Studies", subject: "Accounting", classLevel: "HSC", mode: "offline", location: "Agrabad, Chattogram", monthlyFee: 5000, daysPerWeek: 3, description: "Journal, ledger, trial balance and financial statements with plenty of worked examples." },
  { title: "Bangla 1st & 2nd paper SSC", subject: "Bangla", classLevel: "SSC", mode: "offline", location: "Zindabazar, Sylhet", monthlyFee: 3000, daysPerWeek: 2, description: "Literature analysis, grammar and creative writing practice for SSC Bangla papers." },
  { title: "Economics for university first year", subject: "Economics", classLevel: "University", mode: "online", location: "Online", monthlyFee: 5500, daysPerWeek: 2, description: "Micro and macroeconomics fundamentals with graph-based problem solving." },
  { title: "Class 9-10 Physics concepts", subject: "Physics", classLevel: "Class 9-10", mode: "hybrid", location: "Khulna Sadar, Khulna", monthlyFee: 4000, daysPerWeek: 3, description: "Concept-first physics teaching with experiments and creative question practice." },
  { title: "Spoken English for beginners", subject: "English", classLevel: "Other", mode: "online", location: "Online", monthlyFee: 3500, daysPerWeek: 3, description: "Conversation practice, pronunciation and confidence building for beginners of any age." },
];

function tuitionDoc(
  seed: SeedTuition,
  tutor: { id: ObjectId; name: string; email: string },
  adminId: ObjectId,
  status: TuitionDoc["approvalStatus"],
  isActive: boolean,
  daysAgo: number,
): Omit<TuitionDoc, "_id"> {
  const createdAt = new Date(Date.now() - daysAgo * 86_400_000);
  const history: TuitionDoc["moderationHistory"] = [{ action: "submitted", by: tutor.id, at: createdAt }];
  if (status !== "pending") {
    history.push({
      action: status,
      by: adminId,
      at: createdAt,
      ...(status === "rejected" ? { reason: "Description is too vague; please add syllabus details." } : {}),
    });
  }

  return {
    ...seed,
    bannerImage: null,
    tutorId: tutor.id,
    tutorName: tutor.name,
    tutorEmail: tutor.email,
    approvalStatus: status,
    isActive,
    rejectionReason: status === "rejected" ? "Description is too vague; please add syllabus details." : null,
    moderatedBy: status === "pending" ? null : adminId,
    moderatedAt: status === "pending" ? null : createdAt,
    moderationHistory: history,
    createdAt,
    updatedAt: createdAt,
  };
}

async function main() {
  if (env.isProduction) {
    throw new Error("Refusing to seed with NODE_ENV=production.");
  }

  const { db, auth, close } = await bootstrap();

  try {
    if (hasFlag("reset")) {
      for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) {
        await db.collection(collection.name).deleteMany({});
      }
      console.log("Database wiped.");
    }

    const providedPassword = process.env.SEED_DEMO_PASSWORD?.trim();
    const password = providedPassword || generatePassword();

    const mk = async (name: string, email: string, role: "student" | "tutor" | "admin", plan: "free" | "pro" = "free", phone?: string) => {
      const result = await ensureUser(auth, { name, email, password, role, plan, ...(phone ? { phone } : {}) });
      return { id: result.id, name, email, role, plan, created: result.created };
    };

    const admin = await mk("Demo Admin", "admin@mentorlagbe.test", "admin");
    const students = [
      await mk("Ayesha Rahman", "ayesha.student@mentorlagbe.test", "student", "pro", "+8801711000001"),
      await mk("Rafi Hasan", "rafi.student@mentorlagbe.test", "student", "free", "+8801711000002"),
      await mk("Nusrat Jahan", "nusrat.student@mentorlagbe.test", "student", "free", "+8801711000003"),
      await mk("Tanvir Ahmed", "tanvir.student@mentorlagbe.test", "student", "free"),
    ];
    const tutors = [
      await mk("Dr. Kamal Hossain", "kamal.tutor@mentorlagbe.test", "tutor", "pro", "+8801811000001"),
      await mk("Sadia Islam", "sadia.tutor@mentorlagbe.test", "tutor", "free", "+8801811000002"),
      await mk("Imran Chowdhury", "imran.tutor@mentorlagbe.test", "tutor", "free", "+8801811000003"),
      await mk("Farzana Akter", "farzana.tutor@mentorlagbe.test", "tutor", "free", "+8801811000004"),
    ];

    const existingTuitions = await tuitions().countDocuments({ tutorId: { $in: tutors.map((t) => t.id) } });

    if (existingTuitions > 0) {
      console.log("Demo tuitions already exist; skipping tuition/application/payment seed. Use --reset to start over.");
    } else {
      const [pro, sadia, imran, farzana] = tutors as [typeof tutors[0], typeof tutors[0], typeof tutors[0], typeof tutors[0]];

      // Respect plan limits: free tutors have at most two posts each.
      const plan: Array<[SeedTuition, typeof pro, TuitionDoc["approvalStatus"], boolean]> = [
        ...TUITIONS.slice(0, 8).map((t) => [t, pro, "approved", true] as [SeedTuition, typeof pro, TuitionDoc["approvalStatus"], boolean]),
        [TUITIONS[8]!, sadia, "approved", true],
        [TUITIONS[9]!, sadia, "approved", true],
        [TUITIONS[10]!, imran, "approved", true],
        [TUITIONS[11]!, farzana, "approved", true],
        [{ ...TUITIONS[0]!, title: "HSC Physics weekend batch (pending review)", location: "Banani, Dhaka" }, imran, "pending", true],
        [{ ...TUITIONS[2]!, title: "English tuition (rejected example)", location: "Gulshan, Dhaka" }, farzana, "rejected", true],
        [{ ...TUITIONS[1]!, title: "Math tuition paused (inactive example)", location: "Online" }, pro, "approved", false],
      ];

      const inserted = await tuitions().insertMany(
        plan.map(([seed, tutor, status, active], index) => tuitionDoc(seed, tutor, admin.id, status, active, plan.length - index)) as TuitionDoc[],
      );
      const ids = Object.values(inserted.insertedIds);
      const docs = await tuitions().find({ _id: { $in: ids } }).toArray();
      const byIndex = ids.map((id) => docs.find((d) => d._id.equals(id))!);

      const app = (tuition: TuitionDoc, student: typeof students[0], status: ApplicationDoc["status"], daysAgo: number): Omit<ApplicationDoc, "_id"> => {
        const at = new Date(Date.now() - daysAgo * 86_400_000);
        return {
          tuitionId: tuition._id,
          tuitionTitle: tuition.title,
          subject: tuition.subject,
          monthlyFee: tuition.monthlyFee,
          tutorId: tuition.tutorId,
          tutorEmail: tuition.tutorEmail,
          studentId: student.id,
          studentName: student.name,
          studentEmail: student.email,
          studentPhone: "+880171100000" + (students.indexOf(student) + 1),
          preferredSchedule: "Weekday evenings",
          studentNote: "I would like to join this tuition.",
          isPriority: student.plan === "pro",
          status,
          decidedAt: status === "accepted" || status === "rejected" ? at : null,
          cancelledAt: status === "cancelled" ? at : null,
          appliedAt: at,
          updatedAt: at,
        };
      };

      const [ayesha, rafi, nusrat, tanvir] = students as [typeof students[0], typeof students[0], typeof students[0], typeof students[0]];
      await applications().insertMany([
        app(byIndex[0]!, ayesha, "pending", 3),
        app(byIndex[0]!, rafi, "accepted", 5),
        app(byIndex[0]!, nusrat, "rejected", 6),
        app(byIndex[1]!, rafi, "pending", 2),
        app(byIndex[3]!, ayesha, "accepted", 4),
        app(byIndex[8]!, tanvir, "pending", 1),
        app(byIndex[9]!, nusrat, "cancelled", 2),
        app(byIndex[10]!, ayesha, "pending", 1),
      ] as ApplicationDoc[]);

      const pay = (user: { id: ObjectId; email: string }, role: "student" | "tutor", status: PaymentDoc["status"], n: number): Omit<PaymentDoc, "_id"> => {
        const at = new Date(Date.now() - n * 86_400_000);
        return {
          userId: user.id,
          userEmail: user.email,
          role,
          plan: role === "student" ? "student_pro" : "tutor_pro",
          amount: role === "student" ? 10 : 15,
          currency: "usd",
          stripeSessionId: `cs_demo_${role}_${status}_${n}`,
          stripePaymentIntentId: status === "paid" ? `pi_demo_${role}_${n}` : null,
          status,
          failureReason: status === "failed" ? "demo_card_declined" : null,
          paidAt: status === "paid" ? at : null,
          processedEventIds: [],
          isDemo: true,
          createdAt: at,
          updatedAt: at,
        };
      };

      await payments().insertMany([
        pay(ayesha, "student", "paid", 10),
        pay(pro, "tutor", "paid", 12),
        pay(rafi, "student", "pending", 1),
        pay(sadia, "tutor", "failed", 3),
      ] as PaymentDoc[]);

      console.log(`Seeded ${ids.length} tuitions, 8 applications and 4 demo payments (isDemo: true).`);
    }

    const all = [admin, ...students, ...tutors];
    console.log("\nDemo accounts (local development only):");
    for (const user of all) {
      console.log(`  ${user.role.padEnd(7)} ${user.plan.padEnd(4)} ${user.email}${user.created ? "" : "  (already existed; password unchanged)"}`);
    }
    if (all.some((u) => u.created)) {
      console.log(
        providedPassword
          ? "\nPassword for new accounts: the value of SEED_DEMO_PASSWORD."
          : `\nGenerated password for new accounts (shown once): ${password}`,
      );
    }
  } finally {
    await close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
