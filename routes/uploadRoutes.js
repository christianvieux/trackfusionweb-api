// uploadRoutes.js

import express from "express";
import {
  trackUploadQueue,
  profilePictureUploadQueue,
} from "../queue/uploadQueue.js";
import { authenticateToken } from "../middlewares/authMiddleware.js";
import { belongsToUserUpload, s3Service } from "../services/s3Service.js";
import { buildUploadJobOptions } from "../queue/uploadJobPolicy.js";
import { getUploadConstraints } from "../utils/uploadConstraints.js";
import {
  safeUploadFailure,
  publicUploadFailure,
  uploadTrackSchema,
} from "../utils/trackUploadRequest.js";
import { logDiagnostic, sendSafeError } from "../utils/apiErrors.js";

const router = express.Router();

const uploadProfilePictureSchema = uploadTrackSchema.extract("imageUrl").required();

function validationField(error) {
  return error?.details?.[0]?.path?.[0] || undefined;
}

async function validateStoredObject(reference, rules, label) {
  const metadata = await s3Service.getMetadata(reference.key);
  if (!metadata.exists) {
    return { code: "UPLOAD_EXPIRED", message: `The ${label} upload expired. Select it and try again.` };
  }
  if (!metadata.contentLength) {
    return { code: "EMPTY_FILE", message: `The selected ${label} file is empty.` };
  }
  if (metadata.contentLength > rules.maxBytes) {
    return {
      code: label === "audio" ? "AUDIO_TOO_LARGE" : "IMAGE_TOO_LARGE",
      message: `Your ${label} file exceeds the ${rules.maxBytes / (1024 * 1024)} MiB limit. Choose a smaller file.`,
    };
  }
  return null;
}

router.get("/constraints", authenticateToken, (_req, res) => {
  res.json(getUploadConstraints());
});

// upload track
router.post("/track", authenticateToken, async (req, res) => {
  try {
    // Validate with track schema
    const { error, value } = uploadTrackSchema.validate(req.body);
    if (error) {
      return sendSafeError(req, res, 400, {
        code: "UPLOAD_VALIDATION_FAILED",
        message: error.details[0].message,
        field: validationField(error),
      });
    }

    const userId = req.user.id;
    const {
      trackUrl,
      imageUrl,
      name,
      artist,
      description,
      is_private,
      category,
      genre,
      mood,
      bpm,
    } = value;

    if (
      !belongsToUserUpload(trackUrl.key, userId) ||
      (imageUrl && !belongsToUserUpload(imageUrl.key, userId))
    ) {
      return sendSafeError(req, res, 403, {
        code: "UPLOAD_FORBIDDEN",
        message: "This upload does not belong to the current account.",
      });
    }

    const constraints = getUploadConstraints();
    const [trackObjectError, imageObjectError] = await Promise.all([
      validateStoredObject(trackUrl, constraints.audio, "audio"),
      imageUrl ? validateStoredObject(imageUrl, constraints.image, "artwork") : null,
    ]);
    const objectError = trackObjectError || imageObjectError;
    if (objectError) {
      await Promise.allSettled([
        s3Service.deleteFile(trackUrl.key),
        imageUrl ? s3Service.deleteFile(imageUrl.key) : null,
      ]);
      return sendSafeError(req, res, 400, objectError);
    }

    const jobId = (
      await trackUploadQueue.add("track", {
        userId,
        trackUrl,
        imageUrl,
        name,
        artist,
        description,
        is_private,
        category,
        genre,
        mood,
        bpm,
        referenceId: req.referenceId,
      }, buildUploadJobOptions("track", userId, trackUrl.key))
    ).id;
    // send jobId to client, job started
    res.status(202).json({ jobId });
  } catch (error) {
    logDiagnostic(error, {
      code: "UPLOAD_QUEUE_FAILED",
      referenceId: req.referenceId,
      context: "queue track upload",
    });
    return sendSafeError(req, res, 503, {
      code: "UPLOAD_QUEUE_UNAVAILABLE",
      message: "The upload service is temporarily unavailable. Please try again.",
    });
  }
});

// check status for uploaded file being processed
router.get("/track-status/:jobId", authenticateToken, async (req, res) => {
  try {
    const job = await trackUploadQueue.getJob(req.params.jobId);
    if (!job || String(job.data.userId) !== String(req.user.id)) {
      return res.status(404).json({ error: "Upload job not found" });
    }
    const state = await job.getState();

    const mappedFailure = state === "failed"
      ? job.data.failure || safeUploadFailure(job.failedReason)
      : {};
    const failure = mappedFailure.code ? publicUploadFailure(mappedFailure) : {};
    const response = {
      id: job.id,
      state,
      attemptsMade: job.attemptsMade,
      progress: job._progress,
      result: job.returnvalue,
      ...failure,
      referenceId: job.data.referenceId || req.referenceId,
    };

    res.json(response);
  } catch (error) {
    logDiagnostic(error, {
      code: "UPLOAD_STATUS_FAILED",
      referenceId: req.referenceId,
      context: "read track upload status",
    });
    return sendSafeError(req, res, 503, {
      code: "UPLOAD_STATUS_UNAVAILABLE",
      message: "Upload status is temporarily unavailable. Please try again.",
    });
  }
});

// upload profile-picture
router.post("/profile-picture", authenticateToken, async (req, res) => {
  try {
    // Validate with profile picture schema
    const { error, value } = uploadProfilePictureSchema.validate(req.body.imageUrl);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const userId = req.user.id;
    const imageUrl = value;
    if (!belongsToUserUpload(imageUrl.key, userId)) {
      return res.status(403).json({ error: "Upload key does not belong to this user" });
    }

    const jobId = (
      await profilePictureUploadQueue.add("profile-picture", {
        userId,
        imageUrl,
        referenceId: req.referenceId,
      }, buildUploadJobOptions("profile", userId, imageUrl.key))
    ).id;
    // send jobId to client, job started
    res.status(202).json({ jobId });
  } catch (error) {
    console.error("Error uploading profile picture:", error);
    res.status(500).json({ error: "Failed to upload profile picture" });
  }
});

// check status for profile-picture being processed
router.get(
  "/profile-picture-status/:jobId",
  authenticateToken,
  async (req, res) => {
    try {
      const job = await profilePictureUploadQueue.getJob(req.params.jobId);
      if (!job || String(job.data.userId) !== String(req.user.id)) {
        return res.status(404).json({ error: "Upload job not found" });
      }
      const state = await job.getState();

      const response = {
        id: job.id,
        state,
        attemptsMade: job.attemptsMade,
        progress: job._progress,
        result: job.returnvalue,
        ...(state === "failed"
          ? publicUploadFailure(job.data.failure || job.failedReason)
          : {}),
        referenceId: job.data.referenceId || req.referenceId,
      };

      res.json(response);
    } catch (error) {
      res.status(500).json({ error: "Failed to get status" });
    }
  }
);

export default router;
