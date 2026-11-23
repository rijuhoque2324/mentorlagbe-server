import { Router } from "express";

import { authenticate, requireUser } from "../../middlewares/authenticate.js";
import { sensitiveLimiter } from "../../middlewares/rate-limit.js";
import { sendCreated } from "../../utils/response.js";
import { imageUpload, uploadToImgbb } from "./uploads.service.js";

export const uploadsRouter = Router();

/**
 * POST /uploads/image — authenticated users upload an image and receive a
 * hosted URL. Attaching the URL to a profile or tuition goes through the
 * owning resource's endpoint, which performs its own ownership check.
 */
uploadsRouter.post("/image", authenticate, sensitiveLimiter, imageUpload.single("image"), async (req, res) => {
  const user = requireUser(req);
  const image = await uploadToImgbb(req.file as Express.Multer.File, `upload-${user.id}-${Date.now()}`);
  sendCreated(res, image, "Image uploaded successfully");
});
