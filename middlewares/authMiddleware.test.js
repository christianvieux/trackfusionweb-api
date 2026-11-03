const mockGetUserById = jest.fn();

jest.mock("../controllers/userController.js", () => ({
  getUserById: (...args) => mockGetUserById(...args),
}));

import { authenticateToken } from "./authMiddleware.js";

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test("accepts an authenticated server-side session when the JWT cookie is absent", async () => {
  const req = {
    cookies: {},
    session: { user: { id: 42, username: "listener" } },
  };
  const res = createResponse();
  const next = jest.fn();
  mockGetUserById.mockResolvedValue({
    id: 42,
    username: "listener",
    password_hash: "never expose this",
  });

  await authenticateToken(req, res, next);

  expect(mockGetUserById).toHaveBeenCalledWith(42);
  expect(req.user).toEqual({ id: 42, username: "listener" });
  expect(next).toHaveBeenCalledTimes(1);
  expect(res.status).not.toHaveBeenCalled();
});

test("still rejects requests without either authentication mechanism", async () => {
  const req = { cookies: {}, session: {} };
  const res = createResponse();
  const next = jest.fn();

  await authenticateToken(req, res, next);

  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({
    error: "Access denied: No token provided",
  });
  expect(next).not.toHaveBeenCalled();
});
