import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

/** Only these fields are writable by the profile owner. Role and plan are not. */
export const updateProfileSchema = z
  .strictObject(
    {
      name: z.string().trim().min(2, "Name must be at least 2 characters").max(80).optional(),
      phone: z
        .string()
        .trim()
        .regex(/^\+?[0-9\s-]{6,20}$/, "Enter a valid phone number")
        .or(z.literal(""))
        .transform((value) => (value === "" ? null : value))
        .nullable()
        .optional(),
      bio: optionalText(500),
      location: optionalText(120),
      // Profile photo by URL (alternative to the ImgBB upload endpoint).
      image: z
        .string()
        .trim()
        .max(2048)
        .refine((value) => {
          if (value === "") return true;
          try {
            return new URL(value).protocol === "https:";
          } catch {
            return false;
          }
        }, "Image must be an https:// URL")
        .transform((value) => (value === "" ? null : value))
        .nullable()
        .optional(),
    },
    { error: (issue) => (issue.code === "unrecognized_keys" ? `Field not allowed: ${issue.keys.join(", ")}` : undefined) },
  )
  .refine((value) => Object.keys(value).length > 0, { message: "Provide at least one field to update" });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
