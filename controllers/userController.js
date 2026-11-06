// controllers/userController.js
import { queryToDatabase } from '../services/dbService.js';
import { normalizeEmail } from '../utils/emailUtils.js';
import { authorizeMediaReference, authorizeTrackArtworkList } from '../services/mediaUrlService.js';
import { saveAvatarForUser, validateAvatarConfig } from '../services/avatarService.js';
import { getTrackCollectionPage } from '../services/trackCollectionService.js';

export async function updateUserOnDatabase(userId, properties) {
  const query = `UPDATE users SET ${Object.keys(properties).map((key, index) => `${key} = $${index + 2}`).join(', ')} WHERE id = $1 RETURNING *`;
  const values = [userId, ...Object.values(properties)];
  try {
    const result = await queryToDatabase(query, values);
    return result.rows[0];
  } catch (error) {
    throw error;
  }
}

export async function getUserInfo(email) {
  try {
    const query = "SELECT * FROM users WHERE LOWER(email) = $1";
    const result = await queryToDatabase(query, [normalizeEmail(email)]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  } catch (error) {
    console.error("Error fetching user info:", error);
    throw error;
  }
}

export async function isEmailRegistered(email) {
  const result = await queryToDatabase(
    "SELECT 1 FROM users WHERE LOWER(email) = $1 LIMIT 1",
    [normalizeEmail(email)],
  );
  return result.rows.length > 0;
}

export async function getUserById(userId) {
  const result = await queryToDatabase('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0];
}

export async function getPublicUserInfoFromId(userId) {
  const query = `
    SELECT users.id,
           users.username,
           users.profile_picture_url,
           users.updated_at,
           users.created_at,
           CASE
             WHEN user_avatars.user_id IS NULL THEN NULL
             ELSE json_build_object(
               'shape', user_avatars.shape,
               'expression', user_avatars.expression,
               'color', user_avatars.color,
               'seed', user_avatars.seed
             )
           END AS avatar
      FROM users
      LEFT JOIN user_avatars ON user_avatars.user_id = users.id
     WHERE users.id = $1`;
  const values = [userId];

  try {
    const result = await queryToDatabase(query, values);
    const user = result.rows[0];
    if (user?.profile_picture_url) {
      user.profile_picture_url = await authorizeMediaReference(user.profile_picture_url);
    }
    return user;
  } catch (error) {
    throw error;
  }
}

export async function updateCurrentUserAvatar(req, res) {
  if (!req.user?.id) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const validation = validateAvatarConfig(req.body);
  if (validation.error) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const avatar = await saveAvatarForUser(req.user.id, validation.value);
    return res.status(200).json({ avatar });
  } catch (error) {
    console.error("Error saving avatar:", error);
    return res.status(500).json({ error: "Unable to save avatar" });
  }
}

export async function getUserPublicFavoriteTracks(userId) {
  const query = `
    SELECT tracks.*, 
           COUNT(track_interactions.track_id) AS favorites_count
    FROM tracks
    JOIN track_interactions 
      ON tracks.id = track_interactions.track_id 
      AND track_interactions.interaction_type = 'like'
    WHERE track_interactions.user_id = $1
      AND tracks.is_private = false
    GROUP BY tracks.id
  `;
  const values = [userId];
  try {
    const result = await queryToDatabase(query, values);
    return authorizeTrackArtworkList(result.rows);
  } catch (error) {
    throw error;
  }
}

export function getUserPublicFavoriteTracksPage(userId, options) {
  return getTrackCollectionPage({
    scope: "public-favorites",
    userId,
    ...options,
  });
}

export async function getUserPublicTracks(userId) {
  const query = `
    SELECT tracks.*, 
           (SELECT COUNT(*) 
            FROM track_interactions 
            WHERE track_interactions.track_id = tracks.id 
              AND track_interactions.interaction_type = 'like') AS favorites_count
    FROM tracks 
    WHERE creator_id = $1
      AND tracks.is_private = false
  `;
  const values = [userId];
  try {
    const result = await queryToDatabase(query, values);
    return authorizeTrackArtworkList(result.rows);
  } catch (error) {
    throw error;
  }
}

export function getUserPublicTracksPage(userId, options) {
  return getTrackCollectionPage({ scope: "public-owned", userId, ...options });
}
