import Joi from "joi";
import { getUploadConstraints } from "./uploadConstraints.js";

export const TRACK_CATEGORIES = [
  "Music",
  "Sound Effect",
  "Voice Over",
  "Ambience",
  "Other",
];

export const TRACK_GENRES = [
  "Pop",
  "Rock",
  "Hip Hop",
  "Electronic",
  "Classical",
  "Jazz",
  "R&B",
  "Country",
  "Folk",
  "Metal",
  "Blues",
  "Reggae",
  "World",
  "Latin",
  "Alternative",
  "Indie",
];

export const TRACK_MOODS = [
  "Happy",
  "Sad",
  "Energetic",
  "Calm",
  "Angry",
  "Romantic",
  "Dark",
  "Epic",
  "Funny",
  "Dramatic",
  "Mysterious",
  "Peaceful",
  "Tense",
];

const uploadReferenceSchema = Joi.object({
  key: Joi.string().required(),
  // Accepted for older clients, but never retained in Redis jobs.
  uploadUrl: Joi.string().optional().strip(),
  publicUrl: Joi.string().optional().strip(),
}).required();

function metadataListSchema(label, allowedValues) {
  return Joi.any()
    .custom((value, helpers) => {
      const values = (Array.isArray(value) ? value : String(value || "").split(","))
        .map((item) => String(item).trim())
        .filter(Boolean);

      if (!values.length) return [];
      if (values.some((item) => !allowedValues.includes(item))) {
        return helpers.error("any.only");
      }
      return [...new Set(values)];
    })
    .default([])
    .messages({
      "any.only": `${label} contains an unsupported value`,
    });
}

export const uploadTrackSchema = Joi.object({
  trackUrl: uploadReferenceSchema,
  imageUrl: uploadReferenceSchema.optional(),
  name: Joi.string().trim().min(1).max(100).required().messages({
    "string.empty": "Track title is required",
    "string.max": "Track title cannot exceed 100 characters",
    "any.required": "Track title is required",
  }),
  artist: Joi.string().trim().max(255).allow(null, "").optional(),
  description: Joi.string().max(500).allow("").optional().messages({
    "string.max": "Track description cannot exceed 500 characters",
  }),
  is_private: Joi.boolean().default(false),
  category: Joi.string().valid(...TRACK_CATEGORIES).allow(null, "").optional().messages({
    "any.only": "Select a supported track category",
  }),
  genre: metadataListSchema("Genre", TRACK_GENRES),
  mood: metadataListSchema("Mood", TRACK_MOODS),
  bpm: Joi.number().integer().min(0).max(300).allow(null).optional().messages({
    "number.base": "BPM must be a whole number",
    "number.integer": "BPM must be a whole number",
    "number.min": "BPM must be between 0 and 300",
    "number.max": "BPM must be between 0 and 300",
  }),
});

export const updateTrackSchema = Joi.object({
  name: Joi.string().trim().min(1).max(100).required().messages({
    "string.empty": "Track title is required",
    "string.max": "Track title cannot exceed 100 characters",
    "any.required": "Track title is required",
  }),
  description: Joi.string().max(500).allow("").required().messages({
    "string.max": "Track description cannot exceed 500 characters",
    "any.required": "Track description is required",
  }),
  is_private: Joi.boolean().required().messages({
    "any.required": "Track privacy setting is required",
  }),
});

export function safeUploadFailure(reason) {
  const message = String(reason || "");
  const constraints = getUploadConstraints();
  const audioLimit = constraints.audio.maxBytes / (1024 * 1024);
  const imageLimit = constraints.image.maxBytes / (1024 * 1024);

  if (/image.*(?:file size exceeds|exceeds.*size)|image file exceeds/i.test(message)) {
    return { code: "IMAGE_TOO_LARGE", error: `Your artwork exceeds the ${imageLimit} MiB limit. Choose a smaller file.`, permanent: true };
  }
  if (/audio.*(?:file size exceeds|exceeds.*size)|file size exceeds|entity too large/i.test(message)) {
    return { code: "AUDIO_TOO_LARGE", error: `Your audio file exceeds the ${audioLimit} MiB limit. Choose a smaller file.`, permanent: true };
  }
  if (/audio duration exceeds/i.test(message)) {
    return { code: "AUDIO_TOO_LONG", error: "The audio is longer than the allowed duration.", permanent: true };
  }
  if (/unsupported audio format/i.test(message)) {
    return { code: "UNSUPPORTED_AUDIO_FORMAT", error: "This audio format isn't supported. Choose a WAV, MP3, M4A, AAC, or OGG file.", permanent: true };
  }
  if (/dimensions too small/i.test(message)) {
    return { code: "ARTWORK_TOO_SMALL", error: `This artwork is too small. Please use an image at least ${constraints.image.minWidth} × ${constraints.image.minHeight} pixels.`, permanent: true };
  }
  if (/pixel limit|dimensions too large|input image exceeds/i.test(message)) {
    return { code: "ARTWORK_DIMENSIONS_UNSAFE", error: "This artwork is too large to process safely. Choose an image with smaller dimensions.", permanent: true };
  }
  if (/unsupported image|invalid image|process track artwork/i.test(message)) {
    return { code: "INVALID_IMAGE", error: "We couldn't read this artwork. Try another JPEG, PNG, WebP, HEIC, or HEIF image.", permanent: true };
  }
  if (/invalid audio|audio file structure|analyze audio|validate audio/i.test(message)) {
    return { code: "INVALID_AUDIO", error: "We couldn't read this audio file. Try another supported file.", permanent: true };
  }
  if (/upload file not found|no such key|notfound/i.test(message)) {
    return { code: "UPLOAD_EXPIRED", error: "The temporary upload expired. Select the files and try again.", permanent: true };
  }

  return {
    code: "PROCESSING_FAILED",
    error: "We couldn't process this track. Please try again.",
    permanent: false,
  };
}

export function publicUploadFailure(reasonOrFailure) {
  const failure = typeof reasonOrFailure === "string"
    ? safeUploadFailure(reasonOrFailure)
    : reasonOrFailure || safeUploadFailure();
  return { code: failure.code, error: failure.error };
}
