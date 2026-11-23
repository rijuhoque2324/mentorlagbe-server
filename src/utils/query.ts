import { ObjectId } from "mongodb";
import { z } from "zod";

import { AppError } from "./app-error.js";

export const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

export const objectIdString = z
  .string()
  .trim()
  .regex(OBJECT_ID_PATTERN, "Must be a valid id");

export const idParamSchema = z.object({ id: objectIdString });

export function toObjectId(value: string | ObjectId): ObjectId {
  if (value instanceof ObjectId) {
    return value;
  }

  if (!OBJECT_ID_PATTERN.test(value)) {
    throw AppError.badRequest("Invalid id", { code: "INVALID_ID" });
  }

  return new ObjectId(value);
}

export function idToString(value: unknown): string {
  if (value instanceof ObjectId) {
    return value.toHexString();
  }

  return typeof value === "string" ? value : "";
}

/** Escapes user input before it is placed inside a RegExp so it is matched literally. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function containsRegex(input: string): RegExp {
  return new RegExp(escapeRegex(input.trim()), "i");
}

export function exactInsensitiveRegex(input: string): RegExp {
  return new RegExp(`^${escapeRegex(input.trim())}$`, "i");
}

export const paginationSchema = {
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
};

export function skipFor(page: number, limit: number): number {
  return (page - 1) * limit;
}

/** Converts optional query booleans like "true"/"false" strictly. */
export const queryBoolean = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");
