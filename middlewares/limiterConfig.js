import { rateLimit } from "express-rate-limit";

function createLimiter({ limit, message, windowMs = 15 * 60 * 1000 }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: message },
  });
}

export const apiLimiter = createLimiter({
  limit: 300,
  message: "Too many requests. Please try again later.",
});

export const authLimiter = createLimiter({
  limit: 20,
  message: "Too many authentication attempts. Please try again later.",
});

export const otpLimiter = createLimiter({
  // This coarse IP limit spans generation, verification, and registration.
  // Persisted per-email cooldown and attempt limits provide the tighter guard.
  limit: 30,
  message: "Too many verification-code requests. Please try again later.",
});

export const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user?.id || "anonymous"}`,
  message: {
    error: {
      code: "FEEDBACK_RATE_LIMITED",
      message: "You have sent several reports recently. Please try again later.",
    },
  },
});
