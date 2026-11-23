import type { NextFunction, Request, Response } from "express";

import type { UserRole } from "../types/models.js";
import { AppError } from "../utils/app-error.js";

/** Allows the request only when the authenticated user has one of the given roles. */
export function authorize(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw AppError.unauthorized();
    }

    if (!roles.includes(req.user.role)) {
      throw AppError.forbidden(
        `This action is only available to ${roles.join(" or ")} accounts`,
        "ROLE_FORBIDDEN",
      );
    }

    next();
  };
}
