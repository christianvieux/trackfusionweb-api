import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const MINIMUM_NODE_MAJOR = 22;
export const MINIMUM_NPM_MAJOR = 10;

const GENERATED_SETTINGS = new Set([
  "SESSION_SECRET",
  "JWT_SECRET",
  "POSTGRES_PASSWORD",
]);

export function parseMajorVersion(version) {
  const major = Number.parseInt(String(version).replace(/^v/, "").split(".")[0], 10);
  return Number.isInteger(major) ? major : null;
}

export function npmVersionFromUserAgent(userAgent) {
  return String(userAgent || "").match(/(?:^|\s)npm\/([^\s]+)/)?.[1] || null;
}

export function parseEnvironment(text) {
  const values = {};

  for (const line of String(text).split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/,
    );
    if (!match) continue;

    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "").trim();
    }
    values[match[1]] = value;
  }

  return values;
}

export function findEnvironmentIssues(exampleText, environmentText) {
  const expected = parseEnvironment(exampleText);
  const current = parseEnvironment(environmentText);
  const missing = Object.keys(expected).filter((name) => !current[name]?.trim());
  const placeholders = Object.entries(current)
    .filter(([name, value]) => {
      if (!GENERATED_SETTINGS.has(name) && name !== "DATABASE_URL") return false;
      return /replace_|use_a_|change_me/i.test(value);
    })
    .map(([name]) => name);

  return { missing, placeholders };
}

function replaceSetting(text, name, value) {
  const pattern = new RegExp(`^(${name}=).*$`, "m");
  if (!pattern.test(text)) {
    throw new Error(`.env.example is missing ${name}`);
  }
  return text.replace(pattern, `$1${value}`);
}

export function createDevelopmentEnvironment(exampleText) {
  const sessionSecret = randomBytes(32).toString("base64url");
  const jwtSecret = randomBytes(32).toString("base64url");
  const databasePassword = randomBytes(24).toString("base64url");

  let result = replaceSetting(exampleText, "SESSION_SECRET", sessionSecret);
  result = replaceSetting(result, "JWT_SECRET", jwtSecret);
  result = replaceSetting(result, "POSTGRES_PASSWORD", databasePassword);
  result = replaceSetting(
    result,
    "DATABASE_URL",
    `postgresql://trackfusion:${databasePassword}@localhost:5432/trackfusionweb_db`,
  );
  return result;
}

export async function prepareEnvironment(rootDirectory) {
  const examplePath = path.join(rootDirectory, ".env.example");
  const environmentPath = path.join(rootDirectory, ".env");
  const exampleText = await readFile(examplePath, "utf8");

  try {
    const currentText = await readFile(environmentPath, "utf8");
    return {
      created: false,
      ...findEnvironmentIssues(exampleText, currentText),
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const environmentText = createDevelopmentEnvironment(exampleText);
  await writeFile(environmentPath, environmentText, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  return { created: true, missing: [], placeholders: [] };
}

export function formatEnvironmentIssues({ missing, placeholders }) {
  const messages = [];
  if (missing.length > 0) {
    messages.push(`missing settings: ${missing.join(", ")}`);
  }
  if (placeholders.length > 0) {
    messages.push(`placeholder settings: ${placeholders.join(", ")}`);
  }
  return messages;
}
