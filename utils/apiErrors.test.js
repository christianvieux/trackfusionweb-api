import { buildSafeError, createReferenceId } from "./apiErrors.js";

test("builds a bounded public error without private exception details", () => {
  expect(buildSafeError({
    code: "INTERNAL_ERROR",
    message: "Something went wrong. Please try again.",
    referenceId: "req_123",
  })).toEqual({
    code: "INTERNAL_ERROR",
    message: "Something went wrong. Please try again.",
    referenceId: "req_123",
  });
});

test("creates opaque correlation references", () => {
  expect(createReferenceId("req")).toMatch(
    /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
});
