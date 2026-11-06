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

test("accepts a positive numbered page", () => {
  expect(validateTrackPagination({ page: "3", limit: "6" })).toEqual({
    value: { page: 3, limit: 6 },
  });
});

test.each([
  { limit: 0 },
  { limit: 101 },
  { page: 0 },
  { cursor: "invalid" },
  {
    page: 2,
    cursor: encodeTrackCursor({
      id: 7,
      created_at: "2026-01-01T00:00:00.000Z",
    }),
  },
])("rejects invalid pagination input %#", (query) => {
  expect(validateTrackPagination(query).error).toBeDefined();
});
