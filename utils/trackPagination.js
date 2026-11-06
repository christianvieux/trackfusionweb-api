import Joi from "joi";

import { decodeTrackCursor } from "../services/trackCollectionService.js";

const trackPaginationSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(24),
  page: Joi.number().integer().min(1).optional(),
  cursor: Joi.string()
    .max(512)
    .custom((value, helpers) => {
      try {
        decodeTrackCursor(value);
        return value;
      } catch {
        return helpers.error("any.invalid");
      }
    })
    .messages({ "any.invalid": "Track cursor is invalid" })
    .optional(),
}).oxor("cursor", "page");

export function validateTrackPagination(query = {}) {
  return trackPaginationSchema.validate({
    limit: query.limit,
    cursor: query.cursor,
    page: query.page,
  });
}
