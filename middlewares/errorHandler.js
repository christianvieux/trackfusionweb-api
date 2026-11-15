// middlewares/errorHandler.js
import { logDiagnostic, sendSafeError } from '../utils/apiErrors.js';

export const errorHandler = (err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isUnexpected = status >= 500;
  logDiagnostic(err, {
    code: isUnexpected ? 'INTERNAL_ERROR' : err.code,
    referenceId: req.referenceId,
    context: `${req.method} ${req.path}`,
  });

  return sendSafeError(req, res, status, {
    code: isUnexpected ? 'INTERNAL_ERROR' : err.code || 'REQUEST_FAILED',
    message: isUnexpected
      ? 'Something went wrong. Please try again.'
      : err.message || 'The request could not be completed.',
  });
};
