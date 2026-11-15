const originalEnvironment = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnvironment,
    NODE_ENV: "production",
    FRONTEND_URL: "https://www.trackfusionweb.com",
    CORS_ALLOWED_ORIGINS: "https://www.trackfusionweb.com",
  };
  delete process.env.ALLOWED_BROWSER_ORIGINS;
  delete process.env.DEV_URLS;
});

afterAll(() => {
  process.env = originalEnvironment;
});

test("allows the exact production frontend with credentials", async () => {
  const { corsOptions } = await import("./corsOptions.js");
  const callback = jest.fn();

  corsOptions.origin("https://www.trackfusionweb.com", callback);

  expect(callback).toHaveBeenCalledWith(null, true);
  expect(corsOptions.credentials).toBe(true);
});

test("rejects the retired Vercel production origin", async () => {
  const { corsOptions } = await import("./corsOptions.js");
  const callback = jest.fn();

  corsOptions.origin("https://trackfusionweb.vercel.app", callback);

  const [error] = callback.mock.calls[0];
  expect(error).toMatchObject({
    status: 403,
    code: "CORS_ORIGIN_DENIED",
  });
});

test("rejects the redirect-only apex origin", async () => {
  const { corsOptions } = await import("./corsOptions.js");
  const callback = jest.fn();

  corsOptions.origin("https://trackfusionweb.com", callback);

  const [error] = callback.mock.calls[0];
  expect(error).toMatchObject({
    status: 403,
    code: "CORS_ORIGIN_DENIED",
  });
});

test("rejects an unlisted browser origin", async () => {
  const { corsOptions } = await import("./corsOptions.js");
  const callback = jest.fn();

  corsOptions.origin("https://untrusted.example", callback);

  expect(callback).toHaveBeenCalledTimes(1);
  const [error] = callback.mock.calls[0];
  expect(error).toMatchObject({
    message: "Origin not allowed by CORS",
    status: 403,
    code: "CORS_ORIGIN_DENIED",
  });
});

test("allows configured LAN origins with custom development ports", async () => {
  process.env.NODE_ENV = "development";
  process.env.FRONTEND_URL = "http://localhost:3000";
  process.env.ALLOWED_BROWSER_ORIGINS =
    "http://localhost:3001,http://192.168.1.50:3001";
  const { corsOptions } = await import("./corsOptions.js");
  const allowedCallback = jest.fn();
  const rejectedCallback = jest.fn();

  corsOptions.origin("http://192.168.1.50:3001", allowedCallback);
  corsOptions.origin("http://192.168.1.51:3001", rejectedCallback);

  expect(allowedCallback).toHaveBeenCalledWith(null, true);
  const [error] = rejectedCallback.mock.calls[0];
  expect(error).toMatchObject({
    status: 403,
    code: "CORS_ORIGIN_DENIED",
  });
});
