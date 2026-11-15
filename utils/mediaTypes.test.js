import { normalizeAudioType } from "./mediaTypes.js";

test.each([
  ["audio/mpeg", "mp3"],
  ["audio/x-m4a", "m4a"],
  ["audio/mp4", "m4a"],
  ["audio/x-wav", "wav"],
  ["m4a", "m4a"],
])("normalizes %s to the worker file type %s", (input, expected) => {
  expect(normalizeAudioType(input)).toBe(expected);
});
