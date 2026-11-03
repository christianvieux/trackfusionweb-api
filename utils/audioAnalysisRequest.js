import Joi from "joi";

export const analyzeAudioSchema = Joi.object({
  trackUrl: Joi.object({
    key: Joi.string().trim().min(1).required(),
    // Older clients send the complete presign response. These values are not
    // needed by the worker and signed upload URLs should not be stored in Redis.
    uploadUrl: Joi.string().optional().strip(),
    publicUrl: Joi.string().optional().strip(),
  })
    .unknown(false)
    .required(),
  bpmRange: Joi.string().valid("50-100", "75-150", "100-200").default("50-100"),
}).unknown(false);
