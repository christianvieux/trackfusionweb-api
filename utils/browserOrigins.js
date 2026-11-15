export const DEFAULT_BROWSER_ORIGIN = "http://localhost:3000";

export function parseBrowserOrigin(name, origin) {
  let value;
  try {
    value = new URL(origin);
  } catch {
    throw new Error(`${name} must contain valid HTTP(S) origins`);
  }

  if (
    !["http:", "https:"].includes(value.protocol) ||
    value.username ||
    value.password ||
    value.pathname !== "/" ||
    value.search ||
    value.hash
  ) {
    throw new Error(`${name} must contain exact HTTP(S) origins without paths`);
  }

  return value;
}

export function parseBrowserOriginList(name, value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => parseBrowserOrigin(name, origin));
}

export function browserOriginSettingName(environment = process.env) {
  return environment.ALLOWED_BROWSER_ORIGINS?.trim()
    ? "ALLOWED_BROWSER_ORIGINS"
    : "CORS_ALLOWED_ORIGINS";
}

export function configuredBrowserOrigins(environment = process.env) {
  const settingName = browserOriginSettingName(environment);
  const origins = parseBrowserOriginList(settingName, environment[settingName]);

  if (
    settingName === "CORS_ALLOWED_ORIGINS" &&
    environment.NODE_ENV === "development"
  ) {
    origins.push(
      ...parseBrowserOriginList("DEV_URLS", environment.DEV_URLS),
    );
  }

  return origins;
}

export function resolveAllowedBrowserOrigins(environment = process.env) {
  const frontendOrigins = parseBrowserOriginList(
    "FRONTEND_URL",
    environment.FRONTEND_URL || DEFAULT_BROWSER_ORIGIN,
  );

  return [
    ...new Set(
      [...frontendOrigins, ...configuredBrowserOrigins(environment)].map(
        (origin) => origin.origin,
      ),
    ),
  ];
}

export function resolveStorageBrowserOrigins(environment = process.env) {
  if (environment.STORAGE_CORS_ALLOWED_ORIGINS?.trim()) {
    return parseBrowserOriginList(
      "STORAGE_CORS_ALLOWED_ORIGINS",
      environment.STORAGE_CORS_ALLOWED_ORIGINS,
    ).map((origin) => origin.origin);
  }

  return resolveAllowedBrowserOrigins(environment);
}
