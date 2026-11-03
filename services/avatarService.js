import { queryToDatabase } from "./dbService.js";

export const AVATAR_SHAPES = Object.freeze([
  "circle",
  "pebble",
  "squircle",
  "capsule",
  "triangle",
  "diamond",
  "hexagon",
  "star",
  "cloud",
  "droplet",
  "heart",
  "ghost",
  "cat",
  "bear",
  "bunny",
  "amoeba",
  "flower",
  "clover",
  "leaf",
  "gem",
  "bubble",
]);

export const AVATAR_EXPRESSIONS = Object.freeze([
  "neutral",
  "attentive",
  "focused",
  "surprised",
  "excited",
  "happy",
  "laughing",
  "wink",
  "angry",
  "sad",
  "worried",
  "scared",
  "suspicious",
  "confused",
  "curious",
  "proud",
  "smug",
  "shy",
  "unimpressed",
  "sleepy",
  "pleading",
  "determined",
  "tired",
  "crosseyed",
  "content",
  "dreamy",
]);

export const AVATAR_COLORS = Object.freeze([
  "#8B5CF6",
  "#3B82F6",
  "#14B8A6",
  "#EC4899",
  "#F97316",
  "#FBBF24",
  "#84CC16",
  "#64748B",
]);

const SHAPE_SET = new Set(AVATAR_SHAPES);
const EXPRESSION_SET = new Set(AVATAR_EXPRESSIONS);
const COLOR_SET = new Set(AVATAR_COLORS);
const SEED_PATTERN = /^[0-9a-z]{1,6}$/;
const AVATAR_FIELDS = ["shape", "expression", "color", "seed"];

export function validateAvatarConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "Avatar configuration is required" };
  }

  const fields = Object.keys(value);
  if (
    fields.length !== AVATAR_FIELDS.length ||
    fields.some((field) => !AVATAR_FIELDS.includes(field))
  ) {
    return { error: "Avatar must include only shape, expression, color, and seed" };
  }

  const color = typeof value.color === "string" ? value.color.toUpperCase() : "";
  const seed = typeof value.seed === "number" ? String(value.seed) : value.seed;

  if (!SHAPE_SET.has(value.shape)) return { error: "Unsupported avatar shape" };
  if (!EXPRESSION_SET.has(value.expression)) {
    return { error: "Unsupported avatar expression" };
  }
  if (!COLOR_SET.has(color)) return { error: "Unsupported avatar color" };
  if (typeof seed !== "string" || !SEED_PATTERN.test(seed)) {
    return { error: "Avatar seed must be 1 to 6 lowercase letters or numbers" };
  }

  return {
    value: {
      shape: value.shape,
      expression: value.expression,
      color,
      seed,
    },
  };
}

export async function saveAvatarForUser(userId, avatar) {
  const result = await queryToDatabase(
    `INSERT INTO user_avatars (user_id, shape, expression, color, seed)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET
       shape = EXCLUDED.shape,
       expression = EXCLUDED.expression,
       color = EXCLUDED.color,
       seed = EXCLUDED.seed,
       updated_at = CURRENT_TIMESTAMP
     RETURNING shape, expression, color, seed`,
    [userId, avatar.shape, avatar.expression, avatar.color, avatar.seed],
  );
  return result.rows[0];
}
