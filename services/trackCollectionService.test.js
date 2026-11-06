const mockQueryToDatabase = jest.fn();
const mockAuthorizeTrackArtworkList = jest.fn(async (tracks) => tracks);

jest.mock("./dbService.js", () => ({
  queryToDatabase: (...args) => mockQueryToDatabase(...args),
}));
jest.mock("./mediaUrlService.js", () => ({
  authorizeTrackArtworkList: (...args) => mockAuthorizeTrackArtworkList(...args),
}));

import {
  decodeTrackCursor,
  encodeTrackCursor,
  getTrackCollectionPage,
} from "./trackCollectionService.js";

beforeEach(() => {
  jest.clearAllMocks();
});

test("returns a bounded public page with creator data and a stable cursor", async () => {
  const rows = [
    {
      id: 3,
      created_at: new Date("2026-01-03T00:00:00.000Z"),
      creator: { id: 7, username: "creator", avatar: null },
    },
    {
      id: 2,
      created_at: new Date("2026-01-02T00:00:00.000Z"),
      creator: { id: 7, username: "creator", avatar: null },
    },
    {
      id: 1,
      created_at: new Date("2026-01-01T00:00:00.000Z"),
      creator: { id: 8, username: "second", avatar: { shape: "circle" } },
    },
  ];
  mockQueryToDatabase.mockResolvedValue({ rows });

  const page = await getTrackCollectionPage({ scope: "public", limit: 2 });

  expect(page.tracks).toEqual(rows.slice(0, 2));
  expect(page.pageInfo).toEqual({
    limit: 2,
    hasNextPage: true,
    nextCursor: expect.any(String),
  });
  expect(decodeTrackCursor(page.pageInfo.nextCursor)).toEqual({
    createdAt: "2026-01-02T00:00:00.000Z",
    id: 2,
  });
  expect(mockQueryToDatabase.mock.calls[0][0]).toContain("NOT tracks.is_private");
  expect(mockQueryToDatabase.mock.calls[0][0]).toContain("json_build_object");
  expect(mockQueryToDatabase.mock.calls[0][1]).toEqual([3]);
});

test("uses the cursor boundary and authenticated owner for later pages", async () => {
  mockQueryToDatabase.mockResolvedValue({ rows: [] });
  const cursor = encodeTrackCursor({
    id: 42,
    created_at: "2026-01-02T00:00:00.000Z",
  });

  const page = await getTrackCollectionPage({
    scope: "owned",
    userId: 9,
    limit: 24,
    cursor,
  });

  expect(page).toEqual({
    tracks: [],
    pageInfo: { limit: 24, hasNextPage: false, nextCursor: null },
  });
  expect(mockQueryToDatabase.mock.calls[0][0]).toContain("tracks.creator_id = $1");
  expect(mockQueryToDatabase.mock.calls[0][0]).toContain("tracks.created_at < $2");
  expect(mockQueryToDatabase.mock.calls[0][1]).toEqual([
    9,
    "2026-01-02T00:00:00.000Z",
    42,
    25,
  ]);
});

test("scopes favorite pages to the authenticated user", async () => {
  mockQueryToDatabase.mockResolvedValue({ rows: [] });

  await getTrackCollectionPage({ scope: "favorites", userId: 12, limit: 10 });

  expect(mockQueryToDatabase.mock.calls[0][0]).toContain("favorite.user_id = $1");
  expect(mockQueryToDatabase.mock.calls[0][1]).toEqual([12, 11]);
});

test("returns total metadata for a numbered page", async () => {
  const rows = [
    {
      id: 8,
      created_at: new Date("2026-01-08T00:00:00.000Z"),
      creator: { id: 4, username: "creator", avatar: null },
    },
  ];
  mockQueryToDatabase
    .mockResolvedValueOnce({ rows: [{ total_count: "13" }] })
    .mockResolvedValueOnce({ rows });

  const result = await getTrackCollectionPage({
    scope: "public",
    limit: 6,
    page: 2,
  });

  expect(result).toEqual({
    tracks: rows,
    pageInfo: {
      limit: 6,
      hasNextPage: false,
      nextCursor: null,
      page: 2,
      totalCount: 13,
      totalPages: 3,
    },
  });
  expect(mockQueryToDatabase.mock.calls[0][0]).toContain("COUNT(*)");
  expect(mockQueryToDatabase.mock.calls[0][1]).toEqual([]);
  expect(mockQueryToDatabase.mock.calls[1][0]).toContain("OFFSET $2");
  expect(mockQueryToDatabase.mock.calls[1][1]).toEqual([7, 6]);
});

test.each([
  { limit: 0, cursor: null },
  { limit: 101, cursor: null },
  { limit: 10, page: 0 },
  { limit: 10, cursor: "not-a-cursor" },
])("rejects invalid page boundaries %#", async (options) => {
  await expect(
    getTrackCollectionPage({ scope: "public", ...options }),
  ).rejects.toThrow();
  expect(mockQueryToDatabase).not.toHaveBeenCalled();
});
