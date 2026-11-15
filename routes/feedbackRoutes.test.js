import { feedbackSchema } from "./feedbackRoutes.js";

test("accepts bounded general and contextual feedback", () => {
  expect(feedbackSchema.validate({
    category: "bug",
    description: "The upload screen stopped responding.",
    source: "error",
    errorCode: "PROCESSING_FAILED",
    referenceId: "req_123e4567-e89b-42d3-a456-426614174000",
    pagePath: "/upload",
  }).error).toBeUndefined();
});

test.each([
  [{ category: "other", description: "A useful report" }, "category"],
  [{ category: "bug", description: "x" }, "description"],
  [{ category: "bug", description: "A useful report", pagePath: "/upload?token=secret" }, "pagePath"],
  [{ category: "bug", description: "A useful report", referenceId: "not-a-reference" }, "referenceId"],
])("rejects unsafe or invalid feedback fields", (payload, field) => {
  const { error } = feedbackSchema.validate(payload);
  expect(error.details[0].path[0]).toBe(field);
});
