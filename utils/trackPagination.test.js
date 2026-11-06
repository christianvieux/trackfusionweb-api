import { encodeTrackCursor } from "../services/trackCollectionService.js";
import { validateTrackPagination } from "./trackPagination.js";

test("applies a conservative default page size", () => {
  expect(validateTrackPagination({}).value).toEqual({ limit: 24 });
});

test("accepts a valid stable cursor and bounded limit", () => {
  const cursor = encodeTrackCursor({
    id: 7,
    created_at: "2026-01-01T00:00:00.000Z",
  });

  expect(validateTrackPagination({ cursor, limit: "50" })).toEqual({
    value: { cursor, limit: 50 },
  });
});

test.each([
  { limit: 0 },
  { limit: 101 },
  { cursor: "invalid" },
])("rejects invalid pagination input %#", (query) => {
  expect(validateTrackPagination(query).error).toBeDefined();
});
