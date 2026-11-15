import { normalizeAudioType } from "./mediaTypes.js";

const DEFAULT_AUDIO_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/ogg",
  "audio/x-m4a",
  "audio/mp4",
  "audio/aac",
];

const DEFAULT_IMAGE_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
];

export const MEBIBYTE = 1024 * 1024;
export const DEFAULT_AUDIO_MAX_BYTES = 100 * MEBIBYTE;
export const DEFAULT_IMAGE_MAX_BYTES = 8 * MEBIBYTE;
export const ARTWORK_MIN_DIMENSION = 64;
export const IMAGE_MAX_DIMENSION = 12_000;
export const IMAGE_MAX_PIXELS = 40_000_000;

function parseTypes(value, defaults) {
  const types = String(value || "")
    .split(",")
    .map((type) => type.trim().toLowerCase())
    .filter(Boolean);
  return types.length ? types : defaults;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getUploadConstraints(environment = process.env) {
  return {
    audio: {
      allowedTypes: parseTypes(environment.ALLOWED_AUDIO_TYPES, DEFAULT_AUDIO_TYPES),
      maxBytes: positiveInteger(environment.AUDIO_MAX_FILE_SIZE, 100) * MEBIBYTE,
      maxDurationSeconds: positiveInteger(environment.AUDIO_MAX_LENGTH, 900),
    },
    image: {
      allowedTypes: parseTypes(environment.ALLOWED_IMAGE_TYPES, DEFAULT_IMAGE_TYPES),
      maxBytes: positiveInteger(environment.IMAGE_MAX_FILE_SIZE, 8) * MEBIBYTE,
      minWidth: ARTWORK_MIN_DIMENSION,
      minHeight: ARTWORK_MIN_DIMENSION,
      maxDimension: IMAGE_MAX_DIMENSION,
      maxPixels: IMAGE_MAX_PIXELS,
      optional: true,
    },
    metadata: {
      nameMaxLength: 100,
      descriptionMaxLength: 500,
      bpmMin: 0,
      bpmMax: 300,
      required: [],
    },
  };
}

export function validateUploadDescriptor(descriptor, environment = process.env) {
  const constraints = getUploadConstraints(environment);
  const contentType = String(descriptor.contentType || "").trim().toLowerCase();
  const extension = String(descriptor.fileName || "")
    .toLowerCase()
    .split(".")
    .pop();
  const requestedType = descriptor.type;
  const mediaType =
    requestedType === "track" || contentType.startsWith("audio/")
      ? "audio"
      : "image";
  const rules = constraints[mediaType];
  const detectedType = contentType || `${mediaType}/${extension}`;

  const isAllowed =
    mediaType === "audio"
      ? rules.allowedTypes.map(normalizeAudioType).includes(normalizeAudioType(detectedType))
      : rules.allowedTypes
          .map((type) => type.replace("image/jpg", "image/jpeg"))
          .includes(detectedType.replace("image/jpg", "image/jpeg"));

  if (!isAllowed) {
    return {
      isValid: false,
      error: `Unsupported ${mediaType} format. Allowed types: ${rules.allowedTypes.join(", ")}`,
    };
  }

  if (Number.isFinite(descriptor.size) && descriptor.size > rules.maxBytes) {
    const maxMebibytes = rules.maxBytes / MEBIBYTE;
    return {
      isValid: false,
      code: mediaType === "audio" ? "AUDIO_TOO_LARGE" : "IMAGE_TOO_LARGE",
      error: `${mediaType === "audio" ? "Audio" : "Image"} file exceeds the ${maxMebibytes} MiB limit`,
    };
  }

  return { isValid: true };
}
