import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  findEnvironmentIssues,
  npmVersionFromUserAgent,
  parseEnvironment,
  prepareEnvironment,
} from "./localDevelopmentConfig.js";

const example = `NODE_ENV=development
SESSION_SECRET=replace_with_a_long_random_value
JWT_SECRET=replace_with_a_different_long_random_value
DATABASE_URL=postgresql://trackfusionweb:replace_me@localhost:5432/trackfusionweb_db
POSTGRES_PASSWORD=replace_with_a_local_database_password
STORAGE_PROVIDER=s3-compatible
EMAIL_PROVIDER=smtp
`;

async function temporaryProject() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "trackfusionweb-setup-"));
  await writeFile(path.join(directory, ".env.example"), example);
  return directory;
}

test("creates a fresh environment with unprinted-quality generated credentials", async () => {
  const directory = await temporaryProject();

  await expect(prepareEnvironment(directory)).resolves.toMatchObject({
    created: true,
    missing: [],
    placeholders: [],
    legacy: [],
  });

  const values = parseEnvironment(
    await readFile(path.join(directory, ".env"), "utf8"),
  );
  expect(values.SESSION_SECRET).toHaveLength(43);
  expect(values.JWT_SECRET).toHaveLength(43);
  expect(values.POSTGRES_PASSWORD).toHaveLength(32);
  expect(values.DATABASE_URL).toContain(values.POSTGRES_PASSWORD);
  expect(values.SESSION_SECRET).not.toBe(values.JWT_SECRET);
  if (process.platform !== "win32") {
    expect((await stat(path.join(directory, ".env"))).mode & 0o777).toBe(0o600);
  }
});

test("running setup again never overwrites an existing environment", async () => {
  const directory = await temporaryProject();
  await prepareEnvironment(directory);
  const environmentPath = path.join(directory, ".env");
  const before = await readFile(environmentPath, "utf8");

  const secondRun = await prepareEnvironment(directory);

  expect(secondRun.created).toBe(false);
  await expect(readFile(environmentPath, "utf8")).resolves.toBe(before);
});

test("reports stale environments without changing them", async () => {
  const directory = await temporaryProject();
  const environmentPath = path.join(directory, ".env");
  const stale = "NODE_ENV=development\nSESSION_SECRET=replace_me\n";
  await writeFile(environmentPath, stale);

  const result = await prepareEnvironment(directory);

  expect(result).toMatchObject({ created: false });
  expect(result.missing).toEqual(
    expect.arrayContaining([
      "JWT_SECRET",
      "DATABASE_URL",
      "POSTGRES_PASSWORD",
      "STORAGE_PROVIDER",
      "EMAIL_PROVIDER",
    ]),
  );
  expect(result.placeholders).toContain("SESSION_SECRET");
  await expect(readFile(environmentPath, "utf8")).resolves.toBe(stale);
});

test("does not expose environment values while describing issues", () => {
  const issues = findEnvironmentIssues(example, "NODE_ENV=development\n");
  expect(issues.missing).toContain("SESSION_SECRET");
  expect(JSON.stringify(issues)).not.toContain("replace_with_a_long_random_value");
});

test("reports legacy identities by setting name only", () => {
  const issues = findEnvironmentIssues(
    example,
    example.replace("trackfusionweb", "trackfusion"),
  );
  expect(issues.legacy).toContain("DATABASE_URL");
  expect(JSON.stringify(issues)).not.toContain("replace_me");
});

test("reads the npm version supplied to npm-run scripts without a subprocess", () => {
  expect(npmVersionFromUserAgent("npm/11.13.0 node/v24.16.0 linux x64")).toBe(
    "11.13.0",
  );
  expect(npmVersionFromUserAgent("")).toBeNull();
});

test("parses quoted values and ignores inline comments", () => {
  expect(
    parseEnvironment('QUOTED="value with spaces"\nPLAIN=value # explanation\n'),
  ).toEqual({ QUOTED: "value with spaces", PLAIN: "value" });
});
