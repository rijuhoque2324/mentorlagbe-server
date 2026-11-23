import type { ObjectId } from "mongodb";

import type { PlanTier, UserRole } from "./models.js";

export interface AuthUser {
  _id: ObjectId;
  id: string;
  name: string;
  email: string;
  role: UserRole;
  plan: PlanTier;
  phone: string | null;
  image: string | null;
}

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthUser;
      sessionId?: string;
      validated: {
        body?: unknown;
        query?: unknown;
        params?: unknown;
      };
    }
  }
}

export {};
