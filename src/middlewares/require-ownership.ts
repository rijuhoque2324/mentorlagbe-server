import type { NextFunction, Request, Response } from "express";
import type { ObjectId } from "mongodb";

import { AppError } from "../utils/app-error.js";
import { OBJECT_ID_PATTERN, toObjectId } from "../utils/query.js";

interface OwnershipOptions<T> {
  /** Loads the resource by id. Return null when it does not exist. */
  load: (id: ObjectId) => Promise<T | null>;
  /** Returns the id(s) of the user(s) who own the resource. */
  ownerIds: (resource: T) => Array<ObjectId | null | undefined>;
  /** Route param holding the resource id. Defaults to `id`. */
  param?: string;
  allowAdmin?: boolean;
  notFoundMessage?: string;
  forbiddenMessage?: string;
}

/**
 * Loads a resource and verifies the authenticated user owns it. The loaded
 * resource is placed on `res.locals.resource` for the handler. Non-owners get
 * 403; missing resources get 404.
 */
export function requireOwnership<T>(options: OwnershipOptions<T>) {
  const param = options.param ?? "id";

  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      throw AppError.unauthorized();
    }

    const rawId = req.params[param];

    if (typeof rawId !== "string" || !OBJECT_ID_PATTERN.test(rawId)) {
      throw AppError.badRequest("Invalid id", { code: "INVALID_ID" });
    }

    const resource = await options.load(toObjectId(rawId));

    if (!resource) {
      throw AppError.notFound(options.notFoundMessage ?? "Resource not found");
    }

    const isOwner = options
      .ownerIds(resource)
      .some((ownerId) => ownerId != null && ownerId.equals(user._id));

    if (!isOwner && !(options.allowAdmin && user.role === "admin")) {
      throw AppError.forbidden(options.forbiddenMessage ?? "You do not have access to this resource");
    }

    res.locals.resource = resource;
    next();
  };
}
