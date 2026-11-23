import { Router } from "express";

import { pingDatabase } from "../config/db.js";
import { adminRouter } from "../modules/admin/admin.routes.js";
import { applicationsRouter } from "../modules/applications/applications.routes.js";
import { authInfoRouter } from "../modules/auth/auth.routes.js";
import { bookmarksRouter } from "../modules/bookmarks/bookmarks.routes.js";
import { paymentsRouter } from "../modules/payments/payments.routes.js";
import { plansRouter } from "../modules/plans/plans.routes.js";
import { tuitionsRouter, tutorRouter } from "../modules/tuitions/tuitions.routes.js";
import { uploadsRouter } from "../modules/uploads/uploads.routes.js";
import { usersRouter } from "../modules/users/users.routes.js";

export const apiRouter = Router();

apiRouter.get("/health", async (_req, res) => {
  const database = await pingDatabase();
  res.status(database ? 200 : 503).json({
    success: database,
    message: database ? "OK" : "Database unavailable",
    data: { status: database ? "ok" : "degraded", database: database ? "up" : "down", time: new Date().toISOString() },
  });
});

apiRouter.use("/auth", authInfoRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/tuitions", tuitionsRouter);
apiRouter.use("/tutor", tutorRouter);
apiRouter.use("/applications", applicationsRouter);
apiRouter.use("/bookmarks", bookmarksRouter);
apiRouter.use("/plans", plansRouter);
apiRouter.use("/payments", paymentsRouter);
apiRouter.use("/uploads", uploadsRouter);
apiRouter.use("/admin", adminRouter);
