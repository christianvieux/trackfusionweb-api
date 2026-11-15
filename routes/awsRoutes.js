// routes/uploadRoutes.js
import express from "express";
import Joi from "joi";
import { s3Service } from "../services/s3Service.js"
import { authenticateToken } from "../middlewares/authMiddleware.js";
import { validateUploadDescriptor } from "../utils/uploadConstraints.js";
import { logDiagnostic, sendSafeError } from "../utils/apiErrors.js";

const router = express.Router();
const presignedUrlSchema = Joi.object({
  fileName: Joi.string().max(255).required(),
  contentType: Joi.string().max(100).allow("").optional(),
  type: Joi.string().valid("track", "image", "profile-picture").optional(),
  // Optional for older clients; current clients send it for an early size check.
  size: Joi.number().integer().min(1).optional().messages({
    "number.min": "The selected file is empty",
  }),
});

// Step 1: Get presigned URL for upload
router.post(
  "/presigned-url",
  authenticateToken,
  async (req, res) => {
    try {
      const { error, value } = presignedUrlSchema.validate(req.body);
      if (error) {
        return sendSafeError(req, res, 400, {
          code: "UPLOAD_DESCRIPTOR_INVALID",
          message: error.details[0].message,
          field: error.details[0].path?.[0],
        });
      }

      const descriptorValidation = validateUploadDescriptor(value);
      if (!descriptorValidation.isValid) {
        return sendSafeError(req, res, 400, {
          code: descriptorValidation.code || "UNSUPPORTED_UPLOAD",
          message: descriptorValidation.error,
        });
      }

      const { fileName, contentType } = value;
      const userId = req.user.id;

      // Get presigned URL
      const urls = await s3Service.getPresignedUploadUrl(userId, {
        fileName,
        contentType,
        folder: "uploads",
      });

      res.json(urls); // { key, uploadUrl, publicUrl }
    } catch (error) {
      logDiagnostic(error, {
        code: "UPLOAD_AUTHORIZATION_FAILED",
        referenceId: req.referenceId,
        context: "generate presigned upload URL",
      });
      return sendSafeError(req, res, 503, {
        code: "UPLOAD_SERVICE_UNAVAILABLE",
        message: "The upload service is temporarily unavailable. Please try again.",
      });
    }
  }
);

export default router;
