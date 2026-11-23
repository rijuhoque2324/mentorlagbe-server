import { Router, type Request, type Response } from "express";
import { z } from "zod";

import { authenticate, requireUser } from "../../middlewares/authenticate.js";
import { authorize } from "../../middlewares/authorize.js";
import { body, params, query, validate } from "../../middlewares/validate.js";
import { USER_ROLES, type UserRole } from "../../types/models.js";
import { idParamSchema, paginationSchema, toObjectId } from "../../utils/query.js";
import { sendPaginated, sendSuccess } from "../../utils/response.js";
import { listAllPayments } from "../payments/payments.service.js";
import { listAllTuitions, moderateTuition } from "../tuitions/tuitions.service.js";
import {
  adminTuitionsQuerySchema,
  moderateSchema,
  rejectSchema,
  type AdminTuitionsQuery,
  type ModerateInput,
} from "../tuitions/tuitions.validation.js";
import { changeUserRole, getDashboardStats, getUserDetails, listUsers } from "./admin.service.js";

export const adminRouter = Router();

// Every admin endpoint requires a verified admin session.
adminRouter.use(authenticate, authorize("admin"));

const roleSchema = z.enum(USER_ROLES as [UserRole, ...UserRole[]], {
  error: "Role must be student, tutor or admin",
});

const usersQuery = z.object({
  search: z.string().trim().max(100).optional(),
  role: roleSchema.optional(),
  plan: z.enum(["free", "pro"]).optional(),
  ...paginationSchema,
});

const paymentsQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(["pending", "paid", "failed", "cancelled"]).optional(),
  ...paginationSchema,
});

const roleBody = z.object({ role: roleSchema });

// ---- Dashboard -----------------------------------------------------------

async function stats(_req: Request, res: Response) {
  sendSuccess(res, await getDashboardStats(), "Dashboard stats loaded");
}
adminRouter.get("/dashboard", stats);
adminRouter.get("/stats", stats);

// ---- Users ---------------------------------------------------------------

adminRouter.get("/users", validate({ query: usersQuery }), async (req, res) => {
  const { items, meta } = await listUsers(query<z.infer<typeof usersQuery>>(req));
  sendPaginated(res, items, meta, "Users loaded");
});

adminRouter.get("/users/:id", validate({ params: idParamSchema }), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  sendSuccess(res, await getUserDetails(toObjectId(id)), "User loaded");
});

async function updateRole(req: Request, res: Response) {
  const { id } = params<{ id: string }>(req);
  const { role } = body<{ role: UserRole }>(req);
  sendSuccess(res, await changeUserRole(requireUser(req), toObjectId(id), role), "User role updated");
}
adminRouter.patch("/users/:id/role", validate({ params: idParamSchema, body: roleBody }), updateRole);
adminRouter.patch("/users/:id", validate({ params: idParamSchema, body: roleBody }), updateRole);

// ---- Tuitions ------------------------------------------------------------

adminRouter.get("/tuitions", validate({ query: adminTuitionsQuerySchema }), async (req, res) => {
  const { items, meta } = await listAllTuitions(query<AdminTuitionsQuery>(req));
  sendPaginated(res, items, meta, "Tuitions loaded");
});

adminRouter.patch("/tuitions/:id/approve", validate({ params: idParamSchema }), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  sendSuccess(res, await moderateTuition(toObjectId(id), requireUser(req), "approved"), "Tuition approved");
});

adminRouter.patch("/tuitions/:id/reject", validate({ params: idParamSchema, body: rejectSchema }), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const { reason } = body<{ reason: string }>(req);
  sendSuccess(res, await moderateTuition(toObjectId(id), requireUser(req), "rejected", reason), "Tuition rejected");
});

adminRouter.patch("/tuitions/:id/moderate", validate({ params: idParamSchema, body: moderateSchema }), async (req, res) => {
  const { id } = params<{ id: string }>(req);
  const { status, reason } = body<ModerateInput>(req);
  sendSuccess(res, await moderateTuition(toObjectId(id), requireUser(req), status, reason), `Tuition ${status}`);
});

// ---- Payments ------------------------------------------------------------

async function paymentsList(req: Request, res: Response) {
  const { items, meta } = await listAllPayments(query<z.infer<typeof paymentsQuery>>(req));
  sendPaginated(res, items, meta, "Payments loaded");
}
adminRouter.get("/payments", validate({ query: paymentsQuery }), paymentsList);
adminRouter.get("/transactions", validate({ query: paymentsQuery }), paymentsList);
