import multer from "multer";

import { env } from "../../config/env.js";
import { AppError } from "../../utils/app-error.js";
import { logger } from "../../utils/logger.js";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB
const IMGBB_ENDPOINT = "https://api.imgbb.com/1/upload";
const IMGBB_TIMEOUT_MS = 15_000;

type ImageKind = "jpeg" | "png" | "webp" | "gif";

const ALLOWED_MIME: Record<string, ImageKind> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Multer instance: memory storage, single file, strict size and type limits. */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME[file.mimetype.toLowerCase()]) {
      callback(
        AppError.badRequest("Only JPEG, PNG, WebP or GIF images are allowed", {
          code: "UNSUPPORTED_FILE_TYPE",
        }),
      );
      return;
    }
    callback(null, true);
  },
});

/**
 * Detects the real image type from magic bytes. The client-provided filename
 * and Content-Type are not trusted.
 */
export function detectImageKind(buffer: Buffer): ImageKind | null {
  if (buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  )
    return "png";

  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";

  const gifHeader = buffer.toString("ascii", 0, 6);
  if (gifHeader === "GIF87a" || gifHeader === "GIF89a") return "gif";

  return null;
}

export interface HostedImage {
  url: string;
  displayUrl: string;
  thumbUrl: string | null;
  width: number | null;
  height: number | null;
  size: number;
}

export function assertValidImage(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) {
    throw AppError.badRequest("Attach an image file in the `image` field", { code: "FILE_REQUIRED" });
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new AppError(413, "Image is too large", { code: "FILE_TOO_LARGE" });
  }

  const kind = detectImageKind(file.buffer);
  const declared = ALLOWED_MIME[file.mimetype.toLowerCase()];

  if (!kind || !declared || kind !== declared) {
    throw AppError.badRequest("The file content is not a supported image", {
      code: "UNSUPPORTED_FILE_TYPE",
    });
  }

  return file;
}

type Fetcher = typeof fetch;
let fetcher: Fetcher = (...args) => fetch(...args);

/** Test hook to stub the ImgBB HTTP call. */
export function setImageFetcher(next: Fetcher | null) {
  fetcher = next ?? ((...args) => fetch(...args));
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Uploads a validated image to ImgBB using the server-side API key.
 * Replaced images are retained on ImgBB (the API key cannot delete them);
 * only the stored URL is replaced.
 */
export async function uploadToImgbb(file: Express.Multer.File, name: string): Promise<HostedImage> {
  if (!env.IMGBB_API_KEY) {
    throw AppError.serviceUnavailable("Image uploads are not configured on this server");
  }

  const valid = assertValidImage(file);
  const form = new FormData();
  form.append("image", valid.buffer.toString("base64"));
  form.append("name", name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 60));

  let response: Response;

  try {
    response = await fetcher(`${IMGBB_ENDPOINT}?key=${encodeURIComponent(env.IMGBB_API_KEY)}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(IMGBB_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    logger.warn("ImgBB request failed", { timedOut, error });
    throw AppError.badGateway(
      timedOut ? "The image host timed out. Please try again." : "Could not reach the image host",
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const data = (payload as { data?: Record<string, unknown> } | null)?.data;

  if (!response.ok || !data || !isHttpsUrl(data.url)) {
    logger.warn("ImgBB rejected upload", { status: response.status });
    throw AppError.badGateway("The image host rejected the upload. Please try another image.");
  }

  const thumb = (data.thumb as { url?: unknown } | undefined)?.url;

  return {
    url: data.url,
    displayUrl: isHttpsUrl(data.display_url) ? data.display_url : data.url,
    thumbUrl: isHttpsUrl(thumb) ? thumb : null,
    width: Number(data.width) || null,
    height: Number(data.height) || null,
    size: valid.size,
  };
}

/** Image URLs accepted in JSON bodies must be HTTPS links on ImgBB's hosts. */
export function isAllowedHostedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "ibb.co" || url.hostname.endsWith(".ibb.co"));
  } catch {
    return false;
  }
}
