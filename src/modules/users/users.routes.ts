import { Router } from "express";

import { authenticate, requireUser } from "../../middlewares/authenticate.js";
import { sensitiveLimiter } from "../../middlewares/rate-limit.js";
import { body, validate } from "../../middlewares/validate.js";
import { sendSuccess } from "../../utils/response.js";
import { imageUpload } from "../uploads/uploads.service.js";
import { serializeUser } from "./users.serializer.js";
import { getUserById, updateAvatar, updateProfile } from "./users.service.js";
import { updateProfileSchema, type UpdateProfileInput } from "./users.validation.js";

export const usersRouter = Router();

usersRouter.use(authenticate);

usersRouter.get("/me", async (req, res) => {
  const user = requireUser(req);
  const doc = await getUserById(user._id);
  sendSuccess(res, serializeUser(doc), "Profile loaded");
});

usersRouter.patch("/me", validate({ body: updateProfileSchema }), async (req, res) => {
  const user = requireUser(req);
  const doc = await updateProfile(user._id, body<UpdateProfileInput>(req));
  sendSuccess(res, serializeUser(doc), "Profile updated successfully");
});

usersRouter.post("/me/avatar", sensitiveLimiter, imageUpload.single("image"), async (req, res) => {
  const user = requireUser(req);
  const doc = await updateAvatar(user._id, req.file);
  sendSuccess(res, serializeUser(doc), "Profile image updated successfully");
});
