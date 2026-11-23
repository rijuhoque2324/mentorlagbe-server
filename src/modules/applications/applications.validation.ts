import { z } from "zod";

import { objectIdString, paginationSchema } from "../../utils/query.js";

const applicationFields = {
  preferredSchedule: z.string().trim().max(200, "Preferred schedule must be at most 200 characters").optional(),
  studentNote: z.string().trim().max(1000, "Note must be at most 1000 characters").optional(),
  /** Alias used by the web client. */
  message: z.string().trim().max(1000, "Message must be at most 1000 characters").optional(),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9\s-]{6,20}$/, "Enter a valid phone number")
    .optional(),
};

/** POST /applications — identity, tutor and fee fields are never accepted. */
export const createApplicationSchema = z.object({
  tuitionId: objectIdString,
  ...applicationFields,
});

/** POST /tuitions/:id/apply */
export const applyToTuitionSchema = z.object(applicationFields);

export const applicationListQuerySchema = z.object({
  status: z.enum(["pending", "accepted", "rejected", "cancelled"]).optional(),
  tuitionId: objectIdString.optional(),
  search: z.string().trim().max(100).optional(),
  ...paginationSchema,
});

export const decisionSchema = z.object({
  status: z.enum(["accepted", "rejected"], { error: "Status must be accepted or rejected" }),
});

export type ApplyInput = z.infer<typeof applyToTuitionSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type ApplicationListQuery = z.infer<typeof applicationListQuerySchema>;
