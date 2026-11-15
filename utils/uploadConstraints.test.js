import {
  getUploadConstraints,
  validateUploadDescriptor,
} from "./uploadConstraints.js";

const environment = {
  ALLOWED_AUDIO_TYPES: "audio/mpeg,audio/x-m4a",
  ALLOWED_IMAGE_TYPES: "image/jpeg,image/png",
  AUDIO_MAX_FILE_SIZE: "10",
  AUDIO_MAX_LENGTH: "600",
  IMAGE_MAX_FILE_SIZE: "2",
};

test("exposes the same limits used by presign validation", () => {
  expect(getUploadConstraints(environment)).toEqual(
    expect.objectContaining({
      audio: expect.objectContaining({ maxBytes: 10 * 1024 * 1024 }),
      image: expect.objectContaining({ maxBytes: 2 * 1024 * 1024 }),
    }),
  );
});

test("rejects unsupported formats and oversized files before signing", () => {
  expect(
    validateUploadDescriptor(
      { type: "track", contentType: "audio/mpeg", size: 11 * 1024 * 1024 },
      environment,
    ),
  ).toEqual({
    isValid: false,
    code: "AUDIO_TOO_LARGE",
    error: "Audio file exceeds the 10 MiB limit",
  });

  expect(
    validateUploadDescriptor(
      { type: "track", contentType: "audio/flac", size: 100 },
      environment,
    ),
  ).toEqual(expect.objectContaining({ isValid: false }));

  expect(
    validateUploadDescriptor(
      { type: "image", contentType: "image/png", size: 3 * 1024 * 1024 },
      environment,
    ),
  ).toEqual({
    isValid: false,
    code: "IMAGE_TOO_LARGE",
    error: "Image file exceeds the 2 MiB limit",
  });
});

test("publishes forgiving but bounded artwork and audio defaults", () => {
  const constraints = getUploadConstraints({});

  expect(constraints.audio.maxBytes).toBe(100 * 1024 * 1024);
  expect(constraints.image).toMatchObject({
    maxBytes: 8 * 1024 * 1024,
    minWidth: 64,
    minHeight: 64,
    maxPixels: 40_000_000,
    optional: true,
  });
  expect(constraints.metadata.required).toEqual([]);
  expect(constraints.audio.allowedTypes).toContain("audio/mp4");
  expect(constraints.image.allowedTypes).toContain("image/webp");
});

test("accepts browser MIME aliases for configured M4A and JPEG uploads", () => {
  expect(
    validateUploadDescriptor(
      { type: "track", contentType: "audio/mp4", size: 100 },
      environment,
    ),
  ).toEqual({ isValid: true });
  expect(
    validateUploadDescriptor(
      { type: "image", contentType: "image/jpg", size: 100 },
      environment,
    ),
  ).toEqual({ isValid: true });
  expect(
    validateUploadDescriptor(
      { type: "track", fileName: "recording.m4a", contentType: "", size: 100 },
      environment,
    ),
  ).toEqual({ isValid: true });
});
