import { Router, type Request, type Response } from "express";

import { authenticate, requireUser } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { requireOwnership } from "../../middlewares/require-ownership.js";
import { body, query, validate } from "../../middlewares/validate.js";
import type { ApplicationDoc } from "../../types/models.js";
import { idParamSchema, toObjectId } from "../../utils/query.js";
import { sendCreated, sendPaginated, sendSuccess } from "../../utils/response.js";
import {
  applyToTuition,
  cancelApplication,
  decideApplication,
  findApplicationById,
  getApplicationForViewer,
  listStudentApplications,
  listTutorApplications,
} from "./applications.service.js";
import {
  applicationListQuerySchema,
  createApplicationSchema,
  decisionSchema,
  type ApplicationListQuery,
  type CreateApplicationInput,
} from "./applications.validation.js";

export const applicationsRouter = Router();

applicationsRouter.use(authenticate);

const resource = (res: Response) => res.locals.resource as ApplicationDoc;

const studentOwner = requireOwnership<ApplicationDoc>({
  load: findApplicationById,
  ownerIds: (doc) => [doc.studentId],
  notFoundMessage: "Application not found",
  forbiddenMessage: "You can only manage your own applications",
});

const tutorOwner = requireOwnership<ApplicationDoc>({
  load: findApplicationById,
  ownerIds: (doc) => [doc.tutorId],
  notFoundMessage: "Application not found",
  forbiddenMessage: "You can only manage applicants for your own tuitions",
});

const anyParty = requireOwnership<ApplicationDoc>({
  load: findApplicationById,
  ownerIds: (doc) => [doc.studentId, doc.tutorId],
  allowAdmin: true,
  notFoundMessage: "Application not found",
});

// POST /applications
applicationsRouter.post("/", authorize("student"), validate({ body: createApplicationSchema }), async (req, res) => {
  const input = body<CreateApplicationInput>(req);
  const application = await applyToTuition(requireUser(req), toObjectId(input.tuitionId), input);
  sendCreated(res, application, "Application submitted successfully");
});

// GET /applications/my  (alias: /applications/me)
for (const path of ["/my", "/me"]) {
  applicationsRouter.get(path, authorize("student"), validate({ query: applicationListQuerySchema }), async (req, res) => {
    const { items, meta } = await listStudentApplications(requireUser(req), query<ApplicationListQuery>(req));
    sendPaginated(res, items, meta, "Applications loaded");
  });
}

// GET /applications/tutor
applicationsRouter.get("/tutor", authorize("tutor"), validate({ query: applicationListQuerySchema }), async (req, res) => {
  const { items, meta } = await listTutorApplications(requireUser(req), query<ApplicationListQuery>(req));
  sendPaginated(res, items, meta, "Applicants loaded");
});

// GET /applications/:id
applicationsRouter.get("/:id", validate({ params: idParamSchema }), anyParty, async (req, res) => {
  const application = await getApplicationForViewer(resource(res), requireUser(req));
  sendSuccess(res, application, "Application loaded");
});

// PATCH /applications/:id/cancel  (alias: DELETE /applications/:id)
const cancelHandlers = [
  authorize("student"),
  validate({ params: idParamSchema }),
  studentOwner,
  async (req: Request, res: Response) => {
    const application = await cancelApplication(resource(res), requireUser(req));
    sendSuccess(res, application, "Application cancelled");
  },
] as const;

applicationsRouter.patch("/:id/cancel", ...cancelHandlers);
applicationsRouter.delete("/:id", ...cancelHandlers);

// PATCH /applications/:id/accept | /reject
for (const decision of ["accepted", "rejected"] as const) {
  const path = decision === "accepted" ? "/:id/accept" : "/:id/reject";
  applicationsRouter.patch(path, authorize("tutor"), validate({ params: idParamSchema }), tutorOwner, async (req, res) => {
    const application = await decideApplication(resource(res), requireUser(req), decision);
    sendSuccess(res, application, `Application ${decision}`);
  });
}

// PATCH /applications/:id/status  { status: "accepted" | "rejected" }
applicationsRouter.patch(
  "/:id/status",
  authorize("tutor"),
  validate({ params: idParamSchema, body: decisionSchema }),
  tutorOwner,
  async (req, res) => {
    const { status } = body<{ status: "accepted" | "rejected" }>(req);
    const application = await decideApplication(resource(res), requireUser(req), status);
    sendSuccess(res, application, `Application ${status}`);
  },
);
