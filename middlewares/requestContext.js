import { createReferenceId } from "../utils/apiErrors.js";

export function requestContext(req, res, next) {
  req.referenceId = createReferenceId("req");
  res.setHeader("X-Request-ID", req.referenceId);
  next();
}
