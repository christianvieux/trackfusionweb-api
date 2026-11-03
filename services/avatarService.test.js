import { readFileSync } from "node:fs";

const mockQueryToDatabase = jest.fn();

jest.mock("./dbService.js", () => ({
  queryToDatabase: (...args) => mockQueryToDatabase(...args),
}));

import {
  AVATAR_COLORS,
  AVATAR_EXPRESSIONS,
  AVATAR_SHAPES,
  saveAvatarForUser,
  validateAvatarConfig,
} from "./avatarService.js";

const validAvatar = {
  shape: "ghost",
  expression: "neutral",
  color: "#8B5CF6",
  seed: "2f",
};

const databaseSchema = readFileSync("init_database.sql", "utf8");
const avatarTableStart = databaseSchema.indexOf(
  "CREATE TABLE IF NOT EXISTS public.user_avatars",
);
const avatarTableEnd = databaseSchema.indexOf(
  "CREATE TABLE IF NOT EXISTS public.tracks",
  avatarTableStart,
);
const avatarTableSchema = databaseSchema.slice(avatarTableStart, avatarTableEnd);

function getConstraintValues(constraintName) {
  const marker = `CONSTRAINT ${constraintName}`;
  const start = avatarTableSchema.indexOf(marker);
  const end = avatarTableSchema.indexOf("CONSTRAINT ", start + marker.length);
  const constraint = avatarTableSchema.slice(
    start,
    end === -1 ? undefined : end,
  );

  return [...constraint.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("accepts every supported avatar trait and normalizes color case", () => {
  expect(AVATAR_SHAPES).toHaveLength(21);
  expect(AVATAR_EXPRESSIONS).toHaveLength(26);
  expect(AVATAR_COLORS).toHaveLength(8);
  expect(validateAvatarConfig({ ...validAvatar, color: "#8b5cf6" })).toEqual({
    value: validAvatar,
  });
});

test("keeps database constraints aligned with the API trait allowlists", () => {
  expect(avatarTableStart).toBeGreaterThanOrEqual(0);
  expect(avatarTableEnd).toBeGreaterThan(avatarTableStart);
  expect(getConstraintValues("user_avatars_shape_supported")).toEqual(
    AVATAR_SHAPES,
  );
  expect(getConstraintValues("user_avatars_expression_supported")).toEqual(
    AVATAR_EXPRESSIONS,
  );
  expect(getConstraintValues("user_avatars_color_supported")).toEqual(
    AVATAR_COLORS,
  );
  expect(avatarTableSchema).toContain("seed ~ '^[0-9a-z]{1,6}$'");
});

test.each([
  ["shape", { ...validAvatar, shape: "orb" }, "shape"],
  ["expression", { ...validAvatar, expression: "joy" }, "expression"],
  ["color", { ...validAvatar, color: "#FFFFFF" }, "color"],
  ["seed", { ...validAvatar, seed: "not valid" }, "seed"],
])("rejects an unsupported %s", (_field, avatar, message) => {
  expect(validateAvatarConfig(avatar).error).toMatch(new RegExp(message, "i"));
});

test("rejects extra persisted fields", () => {
  expect(validateAvatarConfig({ ...validAvatar, userId: 99 }).error).toMatch(
    /only shape/i,
  );
});

test("upserts an avatar with a parameterized user id", async () => {
  mockQueryToDatabase.mockResolvedValue({ rows: [validAvatar] });

  await expect(saveAvatarForUser(42, validAvatar)).resolves.toEqual(validAvatar);
  expect(mockQueryToDatabase).toHaveBeenCalledWith(
    expect.stringContaining("ON CONFLICT (user_id)"),
    [42, "ghost", "neutral", "#8B5CF6", "2f"],
  );
});
