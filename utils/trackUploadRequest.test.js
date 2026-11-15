import {
  safeUploadFailure,
  publicUploadFailure,
  updateTrackSchema,
  uploadTrackSchema,
} from "./trackUploadRequest.js";

const validRequest = {
  trackUrl: {
    key: "uploads/42/demo.m4a",
    uploadUrl: "https://storage.example/signed-put",
    publicUrl: "uploads/42/demo.m4a",
  },
  name: "R&B — live mix",
  description: "A local regression fixture",
  is_private: "true",
  category: "Music",
  genre: "R&B,Electronic",
  mood: ["Energetic"],
  bpm: "120",
};

test("normalizes metadata and strips signed URLs before queueing", () => {
  const { error, value } = uploadTrackSchema.validate(validRequest);

  expect(error).toBeUndefined();
  expect(value).toEqual({
    trackUrl: { key: "uploads/42/demo.m4a" },
    name: "R&B — live mix",
    description: "A local regression fixture",
    is_private: true,
    category: "Music",
    genre: ["R&B", "Electronic"],
    mood: ["Energetic"],
    bpm: 120,
  });
});

test.each([
  ["mood", "Unknown", "Mood contains an unsupported value"],
  ["bpm", 301, "BPM must be between 0 and 300"],
])("rejects invalid %s metadata with a specific message", (field, value, message) => {
  const request = { ...validRequest, [field]: value };
  const { error } = uploadTrackSchema.validate(request);
  expect(error.details[0].message).toBe(message);
});

test("allows optional category, genre, and mood metadata", () => {
  const { error, value } = uploadTrackSchema.validate({
    ...validRequest,
    category: undefined,
    genre: "",
    mood: undefined,
  });

  expect(error).toBeUndefined();
  expect(value).toEqual(expect.objectContaining({ genre: [], mood: [] }));
});

test("maps worker details to safe client errors", () => {
  expect(safeUploadFailure("Failed to validate audio file: corrupt atom")).toEqual({
    code: "INVALID_AUDIO",
    error: "We couldn't read this audio file. Try another supported file.",
    permanent: true,
  });
  expect(safeUploadFailure("ECONNRESET storage.internal.local")).toEqual({
    code: "PROCESSING_FAILED",
    error: "We couldn't process this track. Please try again.",
    permanent: false,
  });
});

test("serializes only safe worker failure fields", () => {
  expect(publicUploadFailure({
    code: "PROCESSING_FAILED",
    error: "We couldn't process this track. Please try again.",
    permanent: false,
    stack: "private stack",
  })).toEqual({
    code: "PROCESSING_FAILED",
    error: "We couldn't process this track. Please try again.",
  });
});

test("allows an empty optional description when an owner updates a track", () => {
  const { error, value } = updateTrackSchema.validate({
    name: "Updated title",
    description: "",
    is_private: "true",
  });

  expect(error).toBeUndefined();
  expect(value).toEqual({
    name: "Updated title",
    description: "",
    is_private: true,
  });
});
