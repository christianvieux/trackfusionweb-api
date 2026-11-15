import crypto from "node:crypto";

export function createReferenceId(prefix = "err") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function buildSafeError({ code, message, field, details, referenceId }) {
  const error = { code, message };
  if (field) error.field = field;
  if (details && Object.keys(details).length > 0) error.details = details;
  if (referenceId) error.referenceId = referenceId;
  return error;
}

export function sendSafeError(req, res, status, options) {
  const referenceId = options.referenceId || req?.referenceId || createReferenceId();
  const error = buildSafeError({ ...options, referenceId });
  return res.status(status).json({ error, referenceId });
}

export function logDiagnostic(error, { code, referenceId, context, jobId } = {}) {
  console.error("Application error", {
    code: code || "UNEXPECTED_ERROR",
    referenceId,
    context,
    jobId,
    errorName: error?.name,
    message: error?.message || String(error),
  });
}
