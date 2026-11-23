import { Router } from "express";

import { FREE_STUDENT_BOOKMARK_LIMIT, FREE_TUTOR_POST_LIMIT, PUBLIC_PLAN_CATALOG } from "../../config/plans.js";
import { sendSuccess } from "../../utils/response.js";

export const plansRouter = Router();

plansRouter.get("/", (_req, res) => {
  sendSuccess(
    res,
    {
      billing: "one_time",
      billingNote: "Pro plans are a one-time payment that unlocks Pro for the lifetime of the account.",
      limits: {
        freeTutorPosts: FREE_TUTOR_POST_LIMIT,
        freeStudentBookmarks: FREE_STUDENT_BOOKMARK_LIMIT,
      },
      plans: PUBLIC_PLAN_CATALOG,
    },
    "Plans loaded",
  );
});
