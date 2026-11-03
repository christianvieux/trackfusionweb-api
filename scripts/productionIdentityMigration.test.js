import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const deploy = readFileSync("deploy/ec2/deploy-release.sh", "utf8");
const migration = readFileSync(
  "deploy/ec2/migrate-production-identity.sh",
  "utf8",
);
const compose = readFileSync("compose.yaml", "utf8");

function position(text, fragment) {
  const index = text.indexOf(fragment);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

test("deployment routes an existing legacy installation through the migration", () => {
  expect(deploy).toContain("legacy_app_directory=/opt/trackfusion/api");
  expect(deploy).toContain(
    'exec bash "${migration_script}" "${staging_directory}" "${release_id}"',
  );
});

test("production identity migration backs up before changing state", () => {
  const backup = position(migration, "backup_directory=$(bash");
  const stop = migration.indexOf('systemctl stop "${service_name}"', backup);
  const database = migration.indexOf(
    'reassign_database_identity "${legacy_database_role}" "${database_role}"',
    stop,
  );
  const paths = migration.indexOf('mv -- "${legacy_root}" "${app_root}"', database);

  expect(stop).toBeGreaterThanOrEqual(0);
  expect(database).toBeGreaterThanOrEqual(0);
  expect(paths).toBeGreaterThanOrEqual(0);
  expect(backup).toBeLessThan(stop);
  expect(stop).toBeLessThan(database);
  expect(database).toBeLessThan(paths);
});

test("production identity migration verifies health before retiring legacy identities", () => {
  const health = position(
    migration,
    'bash "${app_directory}/deploy/ec2/check-api-health.sh" 30',
  );
  const parameter = migration.lastIndexOf("aws ssm put-parameter");
  const retireDatabase = migration.lastIndexOf("DROP ROLE trackfusion;");
  const retireUser = migration.lastIndexOf('userdel "${legacy_service_user}"');

  expect(health).toBeLessThan(parameter);
  expect(parameter).toBeLessThan(retireDatabase);
  expect(retireDatabase).toBeLessThan(retireUser);
  expect(migration).toContain("restore_legacy_identity");
  expect(migration).toContain("trap restore_legacy_identity ERR INT HUP TERM");
});

test("Compose migrates an existing database volume before starting the API", () => {
  const migrationService = position(compose, "postgres-identity-migration:");
  const roleRename = position(
    compose,
    "ALTER ROLE trackfusion RENAME TO trackfusionweb;",
  );
  const api = position(compose, "  api:");
  const dependency = compose.indexOf(
    "postgres-identity-migration:",
    api,
  );

  expect(migrationService).toBeLessThan(roleRename);
  expect(dependency).toBeGreaterThan(api);
  expect(compose.slice(dependency)).toContain(
    "condition: service_completed_successfully",
  );
});

function legacyDatabaseUrlEvaluator() {
  const script = migration.split("--eval '")[1]?.split("\n' \"${legacy_config_directory}/.env\"")[0];
  expect(script).toContain("const databaseUrl");
  return script;
}

test.each([
  ["unquoted", "postgresql://trackfusion:example%21@127.0.0.1:5432/trackfusionweb_db"],
  ["quoted", "\"postgresql://trackfusion:example%21@127.0.0.1:5432/trackfusionweb_db\""],
])("legacy database URL parser accepts %s .env values", (_label, value) => {
  const script = legacyDatabaseUrlEvaluator();
  const directory = mkdtempSync(join(tmpdir(), "trackfusionweb-db-url-"));
  try {
    const input = join(directory, ".env");
    const output = join(directory, "database-url");
    writeFileSync(input, "DATABASE_URL=" + value + "\n");
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", script, input, output],
      { encoding: "utf8" },
    );
    expect(result.status).toBe(0);
    expect(readFileSync(output, "utf8")).toBe(
      "postgresql://trackfusion:example%21@127.0.0.1:5432/trackfusionweb_db\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy database URL parser does not leak malformed credentials", () => {
  const script = legacyDatabaseUrlEvaluator();
  const directory = mkdtempSync(join(tmpdir(), "trackfusionweb-db-invalid-"));
  try {
    const input = join(directory, ".env");
    const output = join(directory, "database-url");
    writeFileSync(input, 'DATABASE_URL="not-a-url-private-value"\n');
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", script, input, output],
      { encoding: "utf8" },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("the legacy DATABASE_URL is invalid");
    expect(result.stderr).not.toContain("not-a-url-private-value");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
