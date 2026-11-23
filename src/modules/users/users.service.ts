import type { ObjectId } from "mongodb";

import { users } from "../../db/collections.js";
import type { UserDoc } from "../../types/models.js";
import { AppError } from "../../utils/app-error.js";
import { uploadToImgbb } from "../uploads/uploads.service.js";
import type { UpdateProfileInput } from "./users.validation.js";

export async function getUserById(id: ObjectId): Promise<UserDoc> {
  const doc = await users().findOne({ _id: id });

  if (!doc) {
    throw AppError.notFound("User not found");
  }

  return doc;
}

export async function updateProfile(id: ObjectId, input: UpdateProfileInput): Promise<UserDoc> {
  const current = await getUserById(id);

  // Explicit allowlist: never spread client input into the update.
  const set: Partial<UserDoc> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.phone !== undefined) set.phone = input.phone;
  if (input.bio !== undefined) set.bio = input.bio;
  if (input.location !== undefined) set.location = input.location;

  const nextName = set.name ?? current.name;
  const nextPhone = set.phone !== undefined ? set.phone : current.phone;
  set.profileCompleted = Boolean(nextName && nextPhone);

  const updated = await users().findOneAndUpdate({ _id: id }, { $set: set }, { returnDocument: "after" });

  if (!updated) {
    throw AppError.notFound("User not found");
  }

  return updated;
}

export async function updateAvatar(id: ObjectId, file: Express.Multer.File | undefined): Promise<UserDoc> {
  const image = await uploadToImgbb(file as Express.Multer.File, `avatar-${id.toHexString()}`);

  const updated = await users().findOneAndUpdate(
    { _id: id },
    { $set: { image: image.url, updatedAt: new Date() } },
    { returnDocument: "after" },
  );

  if (!updated) {
    throw AppError.notFound("User not found");
  }

  return updated;
}
