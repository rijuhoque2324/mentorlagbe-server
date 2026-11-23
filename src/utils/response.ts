import type { Response } from "express";

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message = "Request successful",
  statusCode = 200,
): Response {
  return res.status(statusCode).json({ success: true, message, data });
}

export function sendCreated<T>(res: Response, data: T, message = "Created successfully"): Response {
  return sendSuccess(res, data, message, 201);
}

export function sendPaginated<T>(
  res: Response,
  items: T[],
  meta: PaginationMeta,
  message = "Request successful",
): Response {
  return res.status(200).json({ success: true, message, data: items, meta });
}

export function buildMeta(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(limit, 1)));
  return { page, limit, total, totalPages, hasNextPage: page < totalPages };
}
