import { Router, type Request, type Response } from "express";

import { verifyToken, optionalAuthenticate, requireUser } from "../../middlewares/authenticate.js";
import { verifyStudent, verifyTutor } from "../../middlewares/authorize.js";
import { sensitiveLimiter } from "../../middlewares/rate-limit.js";
import { requireOwnership } from "../../middlewares/require-ownership.js";
import { body, params, query, validate } from "../../middlewares/validate.js";
import type { TuitionDoc } from "../../types/models.js";
import { idParamSchema, toObjectId } from "../../utils/query.js";
import { sendCreated, sendPaginated, sendSuccess } from "../../utils/response.js";
import { applyToTuition } from "../applications/applications.service.js";
import { applyToTuitionSchema, type ApplyInput } from "../applications/applications.validation.js";
import { imageUpload } from "../uploads/uploads.service.js";
import {
  createTuition,
  deleteTuition,
  findTuitionById,
  getTuitionForViewer,
  listFeaturedTuitions,
  listPublicTuitions,
  listTutorTuitions,
  setTuitionActive,
  updateTuition,
  updateTuitionBanner,
} from "./tuitions.service.js";
import {
  createTuitionSchema,
  featuredQuerySchema,
  listTuitionsQuerySchema,
  tuitionStatusSchema,
  tutorTuitionsQuerySchema,
  updateTuitionSchema,
  type CreateTuitionInput,
  type ListTuitionsQuery,
  type TutorTuitionsQuery,
  type UpdateTuitionInput,
} from "./tuitions.validation.js";

const ownTuition = requireOwnership<TuitionDoc>({
  load: findTuitionById,
  ownerIds: (doc) => [doc.tutorId],
  notFoundMessage: "Tuition not found",
  forbiddenMessage: "You can only manage your own tuition posts",
});

const resource = (res: Response) => res.locals.resource as TuitionDoc;

async function listMine(req: Request, res: Response) {
  const { items, meta } = await listTutorTuitions(requireUser(req), query<TutorTuitionsQuery>(req));
  sendPaginated(res, items, meta, "Your tuition posts");
}

export const tuitionsRouter = Router();

// ---- Public -------------------------------------------------------------

tuitionsRouter.get("/", optionalAuthenticate, validate({ query: listTuitionsQuerySchema }), async (req, res) => {
  const { items, meta } = await listPublicTuitions(query<ListTuitionsQuery>(req), req.user);
  sendPaginated(res, items, meta, "Tuitions loaded");
});

tuitionsRouter.get("/featured", optionalAuthenticate, validate({ query: featuredQuerySchema }), async (req, res) => {
  const { limit } = query<{ limit: number }>(req);
  sendSuccess(res, await listFeaturedTuitions(limit, req.user), "Featured tuitions loaded");
});

// ---- Tutor (must be registered before "/:id") ---------------------------

tuitionsRouter.get("/mine", verifyToken, verifyTutor, validate({ query: tutorTuitionsQuerySchema }), listMine);

tuitionsRouter.post("/", verifyToken, verifyTutor, validate({ body: createTuitionSchema }), async (req, res) => {
  const tuition = await createTuition(requireUser(req), body<CreateTuitionInput>(req));
  sendCreated(res, tuition, "Tuition created successfully and submitted for approval");
});

tuitionsRouter.get("/:id", optionalAuthenticate, validate({ params: idParamSchema }), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  sendSuccess(res, await getTuitionForViewer(toObjectId(id), req.user), "Tuition loaded");
});

tuitionsRouter.patch(
  "/:id",
  verifyToken,
  verifyTutor,
  validate({ params: idParamSchema, body: updateTuitionSchema }),
  ownTuition,
  async (req, res) => {
    const tuition = await updateTuition(resource(res), requireUser(req), body<UpdateTuitionInput>(req));
    sendSuccess(res, tuition, "Tuition updated successfully");
  },
);

tuitionsRouter.patch(
  "/:id/status",
  verifyToken,
  verifyTutor,
  validate({ params: idParamSchema, body: tuitionStatusSchema }),
  ownTuition,
  async (req, res) => {
    const { isActive } = body<{ isActive: boolean }>(req);
    const tuition = await setTuitionActive(resource(res), requireUser(req), isActive);
    sendSuccess(res, tuition, isActive ? "Tuition activated" : "Tuition deactivated");
  },
);

tuitionsRouter.post(
  "/:id/banner",
  verifyToken,
  verifyTutor,
  sensitiveLimiter,
  validate({ params: idParamSchema }),
  ownTuition,
  imageUpload.single("image"),
  async (req, res) => {
    const tuition = await updateTuitionBanner(resource(res), req.file);
    sendSuccess(res, tuition, "Banner image updated");
  },
);

tuitionsRouter.delete("/:id", verifyToken, verifyTutor, validate({ params: idParamSchema }), ownTuition, async (req, res) => {
  await deleteTuition(resource(res), requireUser(req));
  sendSuccess(res, null, "Tuition deleted successfully");
});

// ---- Student ------------------------------------------------------------

tuitionsRouter.post(
  "/:id/apply",
  verifyToken,
  verifyStudent,
  validate({ params: idParamSchema, body: applyToTuitionSchema }),
  async (req, res) => {
    const { id } = params<{ id: string }>(req);
    const application = await applyToTuition(requireUser(req), toObjectId(id), body<ApplyInput>(req));
    sendCreated(res, application, "Application submitted successfully");
  },
);

// ---- /tutor/tuitions (PRD path) ----------------------------------------

export const tutorRouter = Router();

tutorRouter.get(
  "/tuitions",
  verifyToken,
  verifyTutor,
  validate({ query: tutorTuitionsQuerySchema }),
  listMine,
);
