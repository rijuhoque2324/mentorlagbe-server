import { z } from "zod";

import { TUITION_MODES } from "../../types/models.js";
import { objectIdString, paginationSchema, queryBoolean } from "../../utils/query.js";
import { isAllowedHostedImageUrl } from "../uploads/uploads.service.js";

const text = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional();

export const modeSchema = z
  .string({ error: "Mode is required" })
  .trim()
  .toLowerCase()
  .pipe(z.enum(TUITION_MODES as [string, ...string[]], { error: "Mode must be online, offline or hybrid" }))
  .transform((value) => value as (typeof TUITION_MODES)[number]);

const bannerImage = z
  .string()
  .trim()
  .refine(isAllowedHostedImageUrl, "Banner image must be an uploaded image URL")
  .nullable();

const tuitionFields = {
  title: text(5, 120, "Title"),
  subject: text(2, 60, "Subject"),
  classLevel: text(1, 60, "Class level"),
  mode: modeSchema,
  location: text(2, 120, "Location"),
  monthlyFee: z.coerce
    .number({ error: "Monthly fee must be a number" })
    .finite()
    .min(1, "Monthly fee must be greater than 0")
    .max(1_000_000, "Monthly fee is too large"),
  daysPerWeek: z.coerce
    .number({ error: "Days per week must be a number" })
    .int("Days per week must be a whole number")
    .min(1, "Days per week must be between 1 and 7")
    .max(7, "Days per week must be between 1 and 7"),
  description: text(20, 2000, "Description"),
  requirements: optionalText(1000, "Requirements"),
  availability: optionalText(200, "Availability"),
  bannerImage: bannerImage.optional(),
};

/** Unknown keys (tutorId, approvalStatus, ...) are stripped, never trusted. */
export const createTuitionSchema = z.object({
  ...tuitionFields,
  isActive: z.boolean().optional().default(true),
});

export const updateTuitionSchema = z
  .object({
    title: tuitionFields.title.optional(),
    subject: tuitionFields.subject.optional(),
    classLevel: tuitionFields.classLevel.optional(),
    mode: modeSchema.optional(),
    location: tuitionFields.location.optional(),
    monthlyFee: tuitionFields.monthlyFee.optional(),
    daysPerWeek: tuitionFields.daysPerWeek.optional(),
    description: tuitionFields.description.optional(),
    requirements: tuitionFields.requirements,
    availability: tuitionFields.availability,
    bannerImage: tuitionFields.bannerImage,
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: "Provide at least one field to update",
  });

export const tuitionStatusSchema = z.object({
  isActive: z.boolean({ error: "isActive must be true or false" }),
});

export const SORT_OPTIONS = {
  newest: { createdAt: -1, _id: -1 },
  oldest: { createdAt: 1, _id: 1 },
  fee_asc: { monthlyFee: 1, _id: 1 },
  fee_desc: { monthlyFee: -1, _id: -1 },
} as const;

const SORT_ALIASES: Record<string, keyof typeof SORT_OPTIONS> = {
  newest: "newest",
  latest: "newest",
  "-createdAt": "newest",
  oldest: "oldest",
  createdAt: "oldest",
  fee_asc: "fee_asc",
  "fee-asc": "fee_asc",
  price_asc: "fee_asc",
  monthlyFee: "fee_asc",
  fee_desc: "fee_desc",
  "fee-desc": "fee_desc",
  price_desc: "fee_desc",
  "-monthlyFee": "fee_desc",
};

const sortSchema = z
  .string()
  .trim()
  .refine((value) => Object.hasOwn(SORT_ALIASES, value), {
    message: `Sort must be one of: ${Object.keys(SORT_OPTIONS).join(", ")}`,
  })
  .transform((value) => SORT_ALIASES[value]!)
  .default("newest");

const searchText = z.string().trim().max(100).optional();
const queryFee = z.coerce.number().finite().min(0).max(1_000_000).optional();

export const listTuitionsQuerySchema = z
  .object({
    search: searchText,
    subject: z.string().trim().max(60).optional(),
    classLevel: z.string().trim().max(60).optional(),
    mode: modeSchema.optional(),
    location: z.string().trim().max(120).optional(),
    minFee: queryFee,
    maxFee: queryFee,
    sort: sortSchema,
    ...paginationSchema,
  })
  .refine((value) => value.minFee === undefined || value.maxFee === undefined || value.minFee <= value.maxFee, {
    message: "minFee cannot be greater than maxFee",
    path: ["minFee"],
  });

export const featuredQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(3),
});

export const tutorTuitionsQuerySchema = z.object({
  search: searchText,
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  isActive: queryBoolean.optional(),
  sort: sortSchema,
  ...paginationSchema,
});

export const adminTuitionsQuerySchema = z.object({
  search: searchText,
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  isActive: queryBoolean.optional(),
  tutorId: objectIdString.optional(),
  sort: sortSchema,
  ...paginationSchema,
});

export const moderateSchema = z
  .object({
    status: z.enum(["approved", "rejected"], { error: "Status must be approved or rejected" }),
    reason: z.string().trim().max(500, "Reason must be at most 500 characters").optional(),
  })
  .refine((value) => value.status !== "rejected" || (value.reason && value.reason.length >= 3), {
    message: "A rejection reason of at least 3 characters is required",
    path: ["reason"],
  });

export const rejectSchema = z.object({
  reason: z
    .string({ error: "A rejection reason is required" })
    .trim()
    .min(3, "A rejection reason of at least 3 characters is required")
    .max(500, "Reason must be at most 500 characters"),
});

export type CreateTuitionInput = z.infer<typeof createTuitionSchema>;
export type UpdateTuitionInput = z.infer<typeof updateTuitionSchema>;
export type ListTuitionsQuery = z.infer<typeof listTuitionsQuerySchema>;
export type TutorTuitionsQuery = z.infer<typeof tutorTuitionsQuerySchema>;
export type AdminTuitionsQuery = z.infer<typeof adminTuitionsQuerySchema>;
export type ModerateInput = z.infer<typeof moderateSchema>;
export type SortKey = keyof typeof SORT_OPTIONS;
