import crypto from "crypto";
import { withActiveJobRetention } from "./jobRetention.js";

export function buildUploadJobOptions(kind, userId, key) {
  const digest = crypto
    .createHash("sha256")
    .update(`${kind}\0${userId}\0${key}`)
    .digest("hex")
    .slice(0, 32);

  const options = {
    jobId: `${kind}-${digest}`,
    attempts: 3,
    backoff: { type: "exponential", delay: 1_000 },
  };

  return kind === "track" ? withActiveJobRetention(options) : options;
}

export function isFinalJobAttempt(job) {
  return job.attemptsMade + 1 >= (job.opts.attempts || 1);
}
