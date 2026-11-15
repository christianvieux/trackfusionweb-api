import express from "express";
import Joi from "joi";

import { authenticateToken } from "../middlewares/authMiddleware.js";
import { feedbackLimiter } from "../middlewares/limiterConfig.js";
import { createFeedbackReport } from "../services/feedbackService.js";
import { logDiagnostic, sendSafeError } from "../utils/apiErrors.js";

export const feedbackSchema = Joi.object({
  category: Joi.string().valid("bug", "feedback", "feature").required(),
  description: Joi.string().trim().min(5).max(2000).required().messages({
    "string.empty": "Describe the problem or feedback before submitting.",
    "string.min": "Please provide at least 5 characters.",
    "string.max": "Feedback cannot exceed 2000 characters.",
  }),
  source: Joi.string().valid("general", "error").default("general"),
  errorCode: Joi.string().pattern(/^[A-Z0-9_]{2,64}$/).optional(),
  referenceId: Joi.string().pattern(/^[a-z]+_[0-9a-f-]{36}$/i).max(80).optional(),
  pagePath: Joi.string().pattern(/^\/[^?#]*$/).max(256).optional(),
});

const router = express.Router();

router.post("/", authenticateToken, feedbackLimiter, async (req, res) => {
  const { error, value } = feedbackSchema.validate(req.body, {
    abortEarly: true,
    stripUnknown: true,
  });
  if (error) {
    return sendSafeError(req, res, 400, {
      code: "FEEDBACK_VALIDATION_FAILED",
      message: error.details[0].message,
      field: error.details[0].path?.[0],
    });
  }

  try {
    const report = await createFeedbackReport({
      ...value,
      userId: req.user.id,
    });
    return res.status(201).json({
      message: "Thank you. Your report was saved.",
      reportId: report.id,
    });
  } catch (error) {
    logDiagnostic(error, {
      code: "FEEDBACK_SAVE_FAILED",
      referenceId: req.referenceId,
      context: "save feedback report",
    });
    return sendSafeError(req, res, 503, {
      code: "FEEDBACK_UNAVAILABLE",
      message: "We couldn't save your report. Please try again later.",
    });
  }
});

export default router;
