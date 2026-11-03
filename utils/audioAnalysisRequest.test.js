import { analyzeAudioSchema } from "./audioAnalysisRequest.js";

test("accepts local object references and strips unused presign fields", () => {
  const { error, value } = analyzeAudioSchema.validate({
    trackUrl: {
      key: "uploads/42/example.mp3",
      uploadUrl: "http://127.0.0.1:9000/signed-upload",
      publicUrl: "uploads/42/example.mp3",
    },
    bpmRange: "75-150",
  });

  expect(error).toBeUndefined();
  expect(value).toEqual({
    trackUrl: { key: "uploads/42/example.mp3" },
    bpmRange: "75-150",
  });
});

test("accepts legacy public URLs while retaining only the storage key", () => {
  const { error, value } = analyzeAudioSchema.validate({
    trackUrl: {
      key: "uploads/42/example.mp3",
      publicUrl: "https://bucket.s3.amazonaws.com/uploads/42/example.mp3",
    },
  });

  expect(error).toBeUndefined();
  expect(value.trackUrl).toEqual({ key: "uploads/42/example.mp3" });
  expect(value.bpmRange).toBe("50-100");
});

test("rejects analysis requests without a storage key", () => {
  const { error } = analyzeAudioSchema.validate({
    trackUrl: { publicUrl: "uploads/42/example.mp3" },
  });

  expect(error?.details[0].path).toEqual(["trackUrl", "key"]);
});
