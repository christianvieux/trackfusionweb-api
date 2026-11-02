#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "ERROR: migrate-production-identity.sh must run as root." >&2
  exit 1
fi

staging_directory=${1:-}
release_id=${2:-}
if [[ ! ${release_id} =~ ^[0-9a-f]{40}$ ]] || \
   [[ ${staging_directory} != "/tmp/trackfusionweb-${release_id}" ]] || \
   [[ ! -d ${staging_directory} ]]; then
  echo "ERROR: usage: migrate-production-identity.sh <verified-staging-directory> <40-character-release-id>" >&2
  exit 1
fi

# These are the only intentional legacy names left in the repository. They let
# one release migrate the existing server without deleting data or volumes.
legacy_service_user=trackfusion
legacy_database_role=trackfusion
legacy_root=/opt/trackfusion
legacy_app_directory=${legacy_root}/api
legacy_config_directory=/etc/trackfusion

service_user=trackfusionweb
database_role=trackfusionweb
app_root=/opt/trackfusionweb
app_directory=${app_root}/api
config_directory=/etc/trackfusionweb
database_name=trackfusionweb_db
service_name=trackfusionweb-api
parameter_name=/trackfusionweb/production/api/DATABASE_URL
health_check_script="${staging_directory}/deploy/ec2/check-api-health.sh"

if [[ -d ${app_directory} && -d ${config_directory} ]]; then
  echo "TrackFusionWeb production identity is already active."
  exit 0
fi
if [[ ! -d ${legacy_app_directory} || ! -d ${legacy_config_directory} ]]; then
  echo "ERROR: neither a complete legacy nor TrackFusionWeb installation exists." >&2
  exit 1
fi
if [[ -e ${app_root} || -e ${config_directory} ]]; then
  echo "ERROR: partial TrackFusionWeb identity paths exist; refusing an ambiguous migration." >&2
  exit 1
fi

for command_name in aws cmp id install mv node pg_dump psql rsync runuser \
  systemctl useradd userdel; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "ERROR: required migration command is unavailable: ${command_name}" >&2
    exit 1
  fi
done
for required_file in \
  "${legacy_app_directory}/deploy/ec2/backup-release.sh" \
  "${legacy_config_directory}/.env" \
  "${staging_directory}/deploy/ec2/configure-app.sh" \
  "${staging_directory}/deploy/systemd/trackfusionweb-api.service"; do
  if [[ ! -f ${required_file} || -L ${required_file} ]]; then
    echo "ERROR: required migration input is unsafe or missing: ${required_file}" >&2
    exit 1
  fi
done
if ! id "${legacy_service_user}" >/dev/null 2>&1; then
  echo "ERROR: the legacy service account is missing." >&2
  exit 1
fi
if ! systemctl is-active --quiet "${service_name}" || \
   ! bash "${health_check_script}" 30; then
  echo "ERROR: refusing to migrate an unhealthy production service." >&2
  exit 1
fi

umask 077
working_directory=$(mktemp -d /tmp/trackfusionweb-identity.XXXXXX)
old_database_url_file=${working_directory}/old-database-url
new_database_url_file=${working_directory}/new-database-url
database_password_file=${working_directory}/database-password
parameter_updated=false
migration_started=false
backup_directory=

cleanup() {
  rm -rf -- "${working_directory}"
}

reassign_database_identity() {
  local from_role=$1
  local to_role=$2
  runuser -u postgres -- psql --dbname=postgres --set=ON_ERROR_STOP=1 \
    --variable=from_role="${from_role}" --variable=to_role="${to_role}" <<'SQL'
SELECT format('ALTER DATABASE trackfusionweb_db OWNER TO %I', :'to_role') \gexec
\connect trackfusionweb_db
SELECT format('REASSIGN OWNED BY %I TO %I', :'from_role', :'to_role') \gexec
SQL
}

restore_legacy_identity() {
  local status=$?
  trap - ERR EXIT
  if [[ ${migration_started} != true ]]; then
    cleanup
    exit "${status}"
  fi

  echo "ERROR: identity migration failed; restoring the previous production identity." >&2
  systemctl stop "${service_name}" 2>/dev/null || true

  if [[ ${parameter_updated} == true ]]; then
    aws ssm put-parameter \
      --name "${parameter_name}" \
      --type SecureString \
      --key-id alias/TrackFusionWeb-Production-Parameters \
      --value "file://${old_database_url_file}" \
      --overwrite >/dev/null || true
  fi

  if ! id "${legacy_service_user}" >/dev/null 2>&1; then
    useradd --system --home-dir "${legacy_root}" --no-create-home \
      --shell /usr/sbin/nologin "${legacy_service_user}" || true
  fi
  if ! runuser -u postgres -- psql --dbname=postgres --tuples-only --no-align \
    --command="SELECT 1 FROM pg_roles WHERE rolname = '${legacy_database_role}'" | grep -qx 1; then
    export DATABASE_PASSWORD
    DATABASE_PASSWORD=$(tr -d '\n' < "${database_password_file}")
    runuser --preserve-environment -u postgres -- psql --dbname=postgres \
      --set=ON_ERROR_STOP=1 <<'SQL' || true
\getenv database_password DATABASE_PASSWORD
SELECT format('CREATE ROLE trackfusion WITH LOGIN PASSWORD %L', :'database_password') \gexec
SQL
    unset DATABASE_PASSWORD
  fi
  if runuser -u postgres -- psql --dbname=postgres --tuples-only --no-align \
       --command="SELECT 1 FROM pg_roles WHERE rolname = '${database_role}'" | grep -qx 1; then
    reassign_database_identity "${database_role}" "${legacy_database_role}" || true
  fi

  if [[ -d ${app_root} && ! -e ${legacy_root} ]]; then
    mv -- "${app_root}" "${legacy_root}"
  fi
  if [[ -d ${config_directory} && ! -e ${legacy_config_directory} ]]; then
    mv -- "${config_directory}" "${legacy_config_directory}"
  fi
  if [[ -n ${backup_directory} && -d ${backup_directory} ]]; then
    rsync -a --delete "${backup_directory}/release/" "${legacy_app_directory}/" || true
    rsync -a --delete "${backup_directory}/config/" "${legacy_config_directory}/" || true
    if [[ -f ${backup_directory}/host/systemd/trackfusionweb-api.service ]]; then
      install -o root -g root -m 0644 \
        "${backup_directory}/host/systemd/trackfusionweb-api.service" \
        /etc/systemd/system/trackfusionweb-api.service
    fi
  fi
  chown -R "${legacy_service_user}:${legacy_service_user}" "${legacy_root}" || true
  systemctl daemon-reload || true
  systemctl start "${service_name}" || true
  if id "${service_user}" >/dev/null 2>&1; then
    userdel "${service_user}" 2>/dev/null || true
  fi
  cleanup
  exit "${status}"
}
trap cleanup EXIT
trap restore_legacy_identity ERR INT HUP TERM

/usr/local/bin/node --input-type=module --eval '
  import { readFileSync, writeFileSync } from "node:fs";
  const [environmentPath, oldUrlPath] = process.argv.slice(1);
  const line = readFileSync(environmentPath, "utf8")
    .split(/\r?\n/)
    .find((entry) => entry.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL is missing");
  const url = new URL(line.slice("DATABASE_URL=".length));
  if (url.username !== "trackfusion") {
    throw new Error("the legacy database identity is not present");
  }
  writeFileSync(oldUrlPath, `${url.toString()}\n`, { mode: 0o600 });
' "${legacy_config_directory}/.env" "${old_database_url_file}"

echo "Creating a protected pre-migration backup." >&2
backup_directory=$(bash \
  "${legacy_app_directory}/deploy/ec2/backup-release.sh" "${release_id}")

systemctl stop "${service_name}"
migration_started=true

if ! id "${service_user}" >/dev/null 2>&1; then
  useradd --system --home-dir "${app_root}" --no-create-home \
    --shell /usr/sbin/nologin "${service_user}"
fi

/usr/local/bin/node --input-type=module --eval '
  import { readFileSync, writeFileSync } from "node:fs";
  const [oldUrlPath, newUrlPath, passwordPath] = process.argv.slice(1);
  const url = new URL(readFileSync(oldUrlPath, "utf8").trim());
  writeFileSync(passwordPath, `${decodeURIComponent(url.password)}\n`, { mode: 0o600 });
  url.username = "trackfusionweb";
  writeFileSync(newUrlPath, `${url.toString()}\n`, { mode: 0o600 });
' "${old_database_url_file}" "${new_database_url_file}" "${database_password_file}"

export DATABASE_PASSWORD
DATABASE_PASSWORD=$(tr -d '\n' < "${database_password_file}")
runuser --preserve-environment -u postgres -- psql --dbname=postgres \
  --set=ON_ERROR_STOP=1 <<'SQL'
\getenv database_password DATABASE_PASSWORD
SELECT format('CREATE ROLE trackfusionweb WITH LOGIN PASSWORD %L', :'database_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'trackfusionweb') \gexec
SELECT format('ALTER ROLE trackfusionweb WITH LOGIN PASSWORD %L', :'database_password') \gexec
SQL
unset DATABASE_PASSWORD
reassign_database_identity "${legacy_database_role}" "${database_role}"

mv -- "${legacy_root}" "${app_root}"
mv -- "${legacy_config_directory}" "${config_directory}"

/usr/local/bin/node --input-type=module --eval '
  import { readFileSync, writeFileSync } from "node:fs";
  const [environmentPath, databaseUrlPath] = process.argv.slice(1);
  const databaseUrl = readFileSync(databaseUrlPath, "utf8").trim();
  const result = readFileSync(environmentPath, "utf8")
    .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${databaseUrl}`)
    .replaceAll("/opt/trackfusion/", "/opt/trackfusionweb/");
  writeFileSync(environmentPath, result, { mode: 0o600 });
' "${config_directory}/.env" "${new_database_url_file}"

rsync -a --delete \
  --exclude='venv/' \
  --exclude='node_modules/' \
  --exclude='uploads/' \
  "${staging_directory}/" "${app_directory}/"
chown -R "${service_user}:${service_user}" "${app_root}"

bash "${app_directory}/deploy/ec2/configure-app.sh"
if ! bash "${app_directory}/deploy/ec2/check-api-health.sh" 30; then
  echo "ERROR: migrated application failed its health check." >&2
  false
fi

selector_file=${config_directory}/secret-source
if [[ -f ${selector_file} ]] && grep -Fqx ssm-parameter-store "${selector_file}"; then
  aws ssm put-parameter \
    --name "${parameter_name}" \
    --type SecureString \
    --key-id alias/TrackFusionWeb-Production-Parameters \
    --value "file://${new_database_url_file}" \
    --overwrite >/dev/null
  parameter_updated=true
fi

runuser -u postgres -- psql --dbname="${database_name}" --set=ON_ERROR_STOP=1 <<'SQL'
DROP OWNED BY trackfusion;
SQL
runuser -u postgres -- psql --dbname=postgres --set=ON_ERROR_STOP=1 <<'SQL'
DROP OWNED BY trackfusion;
DROP ROLE trackfusion;
SQL
userdel "${legacy_service_user}"

migration_started=false
trap cleanup EXIT
echo "TrackFusionWeb production identity migration completed successfully."
