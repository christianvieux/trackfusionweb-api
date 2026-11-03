const mockSaveAvatarForUser = jest.fn();
const mockValidateAvatarConfig = jest.fn();
const mockQueryToDatabase = jest.fn();

jest.mock("../services/avatarService.js", () => ({
  saveAvatarForUser: (...args) => mockSaveAvatarForUser(...args),
  validateAvatarConfig: (...args) => mockValidateAvatarConfig(...args),
}));
jest.mock("../services/dbService.js", () => ({
  queryToDatabase: (...args) => mockQueryToDatabase(...args),
}));
jest.mock("../services/mediaUrlService.js", () => ({
  authorizeMediaReference: jest.fn((value) => value),
  authorizeTrackArtworkList: jest.fn((value) => value),
}));

import {
  getPublicUserInfoFromId,
  updateCurrentUserAvatar,
} from "./userController.js";

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("rejects an avatar update without an authenticated user", async () => {
  const res = createResponse();

  await updateCurrentUserAvatar({ body: {} }, res);

  expect(res.status).toHaveBeenCalledWith(401);
  expect(mockSaveAvatarForUser).not.toHaveBeenCalled();
});

test("saves for the authenticated user instead of a client supplied id", async () => {
  const avatar = {
    shape: "ghost",
    expression: "neutral",
    color: "#8B5CF6",
    seed: "2f",
  };
  mockValidateAvatarConfig.mockReturnValue({ value: avatar });
  mockSaveAvatarForUser.mockResolvedValue(avatar);
  const res = createResponse();

  await updateCurrentUserAvatar(
    { user: { id: 42 }, body: { ...avatar, userId: 999 } },
    res,
  );

  expect(mockSaveAvatarForUser).toHaveBeenCalledWith(42, avatar);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({ avatar });
});

test("returns validation errors without writing", async () => {
  mockValidateAvatarConfig.mockReturnValue({ error: "Unsupported avatar color" });
  const res = createResponse();

  await updateCurrentUserAvatar({ user: { id: 42 }, body: {} }, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(mockSaveAvatarForUser).not.toHaveBeenCalled();
});

test("includes a saved avatar in the existing public user response", async () => {
  const avatar = {
    shape: "heart",
    expression: "happy",
    color: "#EC4899",
    seed: "abc123",
  };
  mockQueryToDatabase.mockResolvedValue({
    rows: [{ id: 42, username: "listener", avatar }],
  });

  await expect(getPublicUserInfoFromId(42)).resolves.toEqual({
    id: 42,
    username: "listener",
    avatar,
  });
  expect(mockQueryToDatabase).toHaveBeenCalledWith(
    expect.stringContaining("LEFT JOIN user_avatars"),
    [42],
  );
});

test("keeps existing users without a saved avatar compatible", async () => {
  mockQueryToDatabase.mockResolvedValue({
    rows: [{ id: 43, username: "new-listener", avatar: null }],
  });

  await expect(getPublicUserInfoFromId(43)).resolves.toMatchObject({
    id: 43,
    avatar: null,
  });
});
