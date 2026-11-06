import { queryToDatabase } from "./dbService.js";
import { authorizeTrackArtworkList } from "./mediaUrlService.js";

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;

export function encodeTrackCursor(track) {
  if (!track?.created_at || !track?.id) return null;

  return Buffer.from(
    JSON.stringify({ createdAt: new Date(track.created_at).toISOString(), id: track.id }),
  ).toString("base64url");
}

export function decodeTrackCursor(cursor) {
  if (!cursor) return null;

  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    const createdAt = new Date(value.createdAt);
    const id = Number(value.id);

    if (Number.isNaN(createdAt.getTime()) || !Number.isInteger(id) || id < 1) {
      throw new Error("Invalid cursor");
    }

    return { createdAt: createdAt.toISOString(), id };
  } catch {
    throw new Error("Invalid track cursor");
  }
}

function normalizeLimit(limit) {
  const parsedLimit = Number(limit ?? DEFAULT_PAGE_SIZE);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_PAGE_SIZE) {
    throw new Error(`Track page limit must be between 1 and ${MAX_PAGE_SIZE}`);
  }
  return parsedLimit;
}

function normalizePage(page) {
  if (page == null) return null;

  const parsedPage = Number(page);
  if (!Number.isInteger(parsedPage) || parsedPage < 1) {
    throw new Error("Track page must be a positive integer");
  }
  return parsedPage;
}

function buildScope(scope, userId, values) {
  if (scope === "public") return "NOT tracks.is_private";

  if (!Number.isInteger(Number(userId)) || Number(userId) < 1) {
    throw new Error("A valid user ID is required");
  }

  values.push(Number(userId));
  const userParameter = `$${values.length}`;

  if (scope === "owned") return `tracks.creator_id = ${userParameter}`;
  if (scope === "public-owned") {
    return `tracks.creator_id = ${userParameter} AND NOT tracks.is_private`;
  }
  if (scope === "favorites") {
    return `EXISTS (
      SELECT 1
        FROM track_interactions favorite
       WHERE favorite.track_id = tracks.id
         AND favorite.user_id = ${userParameter}
         AND favorite.interaction_type = 'like'
    )`;
  }
  if (scope === "public-favorites") {
    return `NOT tracks.is_private AND EXISTS (
      SELECT 1
        FROM track_interactions favorite
       WHERE favorite.track_id = tracks.id
         AND favorite.user_id = ${userParameter}
         AND favorite.interaction_type = 'like'
    )`;
  }

  throw new Error("Unsupported track collection scope");
}

export async function getTrackCollectionPage({
  scope,
  userId,
  limit,
  cursor,
  page,
}) {
  const pageSize = normalizeLimit(limit);
  const decodedCursor = decodeTrackCursor(cursor);
  const pageNumber = normalizePage(page);

  if (decodedCursor && pageNumber) {
    throw new Error("Use either a track cursor or page number, not both");
  }

  const values = [];
  const conditions = [buildScope(scope, userId, values)];
  let totalCount = null;

  if (pageNumber) {
    const countValues = [];
    const countScope = buildScope(scope, userId, countValues);
    const countResult = await queryToDatabase(
      `SELECT COUNT(*) AS total_count
         FROM tracks
        WHERE ${countScope}`,
      countValues,
    );
    totalCount = Number(countResult.rows[0]?.total_count || 0);
  }

  if (decodedCursor) {
    values.push(decodedCursor.createdAt, decodedCursor.id);
    const createdAtParameter = `$${values.length - 1}`;
    const idParameter = `$${values.length}`;
    conditions.push(
      `(tracks.created_at < ${createdAtParameter} OR (tracks.created_at = ${createdAtParameter} AND tracks.id < ${idParameter}))`,
    );
  }

  values.push(pageSize + 1);
  const limitParameter = `$${values.length}`;
  let offsetClause = "";
  if (pageNumber) {
    values.push((pageNumber - 1) * pageSize);
    offsetClause = `OFFSET $${values.length}`;
  }
  const result = await queryToDatabase(
    `WITH page AS MATERIALIZED (
       SELECT tracks.*
         FROM tracks
        WHERE ${conditions.join(" AND ")}
        ORDER BY tracks.created_at DESC, tracks.id DESC
        LIMIT ${limitParameter}
        ${offsetClause}
     )
     SELECT page.*,
            favorite_counts.favorites_count,
            json_build_object(
              'id', creators.id,
              'username', creators.username,
              'avatar', CASE
                WHEN creator_avatars.user_id IS NULL THEN NULL
                ELSE json_build_object(
                  'shape', creator_avatars.shape,
                  'expression', creator_avatars.expression,
                  'color', creator_avatars.color,
                  'seed', creator_avatars.seed
                )
              END
            ) AS creator
       FROM page
       JOIN users creators ON creators.id = page.creator_id
       LEFT JOIN user_avatars creator_avatars
         ON creator_avatars.user_id = creators.id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS favorites_count
           FROM track_interactions interaction
          WHERE interaction.track_id = page.id
            AND interaction.interaction_type = 'like'
       ) favorite_counts ON TRUE
      ORDER BY page.created_at DESC, page.id DESC`,
    values,
  );

  const hasNextPage = result.rows.length > pageSize;
  const pageRows = result.rows.slice(0, pageSize);
  const tracks = await authorizeTrackArtworkList(pageRows);

  const pageInfo = {
    limit: pageSize,
    hasNextPage,
    nextCursor: hasNextPage ? encodeTrackCursor(pageRows.at(-1)) : null,
  };

  if (pageNumber) {
    pageInfo.page = pageNumber;
    pageInfo.totalCount = totalCount;
    pageInfo.totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  }

  return {
    tracks,
    pageInfo,
  };
}
