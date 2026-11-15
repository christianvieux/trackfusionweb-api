import {
  configuredBrowserOrigins,
  resolveAllowedBrowserOrigins,
  resolveStorageBrowserOrigins,
} from "./browserOrigins.js";

test("uses the descriptive browser-origin setting when configured", () => {
  const environment = {
    NODE_ENV: "development",
    FRONTEND_URL: "http://localhost:3000",
    ALLOWED_BROWSER_ORIGINS:
      "http://localhost:3001, http://192.168.1.50:3001",
    CORS_ALLOWED_ORIGINS: "http://legacy.example:3000",
    DEV_URLS: "http://legacy-dev.example:3000",
  };

  expect(resolveAllowedBrowserOrigins(environment)).toEqual([
    "http://localhost:3000",
    "http://localhost:3001",
    "http://192.168.1.50:3001",
  ]);
});

test("keeps the legacy CORS and development settings as fallback", () => {
  const origins = configuredBrowserOrigins({
    NODE_ENV: "development",
    CORS_ALLOWED_ORIGINS: "http://localhost:3000",
    DEV_URLS: "http://192.168.1.50:3001",
  });

  expect(origins.map((origin) => origin.origin)).toEqual([
    "http://localhost:3000",
    "http://192.168.1.50:3001",
  ]);
});

test("uses the browser allowlist for local storage by default", () => {
  expect(
    resolveStorageBrowserOrigins({
      NODE_ENV: "development",
      FRONTEND_URL: "http://localhost:3000",
      ALLOWED_BROWSER_ORIGINS: "http://192.168.1.50:3001",
    }),
  ).toEqual(["http://localhost:3000", "http://192.168.1.50:3001"]);
});

test("rejects browser origins with credentials or paths", () => {
  expect(() =>
    configuredBrowserOrigins({
      ALLOWED_BROWSER_ORIGINS: "http://user@localhost:3000/path",
    }),
  ).toThrow(
    "ALLOWED_BROWSER_ORIGINS must contain exact HTTP(S) origins without paths",
  );
});
