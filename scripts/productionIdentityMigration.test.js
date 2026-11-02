import { readFileSync } from "node:fs";

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
