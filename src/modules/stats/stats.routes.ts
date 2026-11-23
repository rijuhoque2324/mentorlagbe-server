import { Router } from "express";

import { applications, tuitions, users } from "../../db/collections.js";
import { sendSuccess } from "../../utils/response.js";

export const statsRouter = Router();

const PUBLIC_TUITION_FILTER = { approvalStatus: "approved", isActive: true } as const;

/**
 * GET /api/v1/stats/public — aggregate, non-identifying platform numbers for
 * the landing page (counters and popular subjects). Cached briefly at the CDN.
 */
statsRouter.get("/public", async (_req, res) => {
  const [students, tutors, liveTuitions, acceptedApplications, subjects] = await Promise.all([
    users().countDocuments({ role: "student" }),
    users().countDocuments({ role: "tutor" }),
    tuitions().countDocuments(PUBLIC_TUITION_FILTER),
    applications().countDocuments({ status: "accepted" }),
    tuitions()
      .aggregate<{ _id: string; count: number }>([
        { $match: PUBLIC_TUITION_FILTER },
        { $group: { _id: "$subject", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 8 },
      ])
      .toArray(),
  ]);

  res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
  sendSuccess(
    res,
    {
      students,
      tutors,
      liveTuitions,
      acceptedApplications,
      subjects: subjects.map((entry) => ({ subject: entry._id, count: entry.count })),
    },
    "Platform statistics loaded",
  );
});
