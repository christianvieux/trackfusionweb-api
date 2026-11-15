import { readFile, readdir } from "fs/promises";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to initialize the database");
  process.exit(1);
}

const schema = await readFile(new URL("../init_database.sql", import.meta.url), "utf8");
const migrationsDirectory = new URL("../migrations/", import.meta.url);
const migrationNames = (await readdir(migrationsDirectory))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let client;

try {
  client = await pool.connect();
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('trackfusionweb_schema_init')::bigint)",
  );
  await client.query(schema);
  await client.query(
    `CREATE TABLE IF NOT EXISTS public.schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );
  const appliedResult = await client.query(
    "SELECT name FROM public.schema_migrations",
  );
  const applied = new Set(appliedResult.rows.map((row) => row.name));
  for (const name of migrationNames) {
    if (applied.has(name)) continue;
    const migration = await readFile(new URL(name, migrationsDirectory), "utf8");
    await client.query(migration);
    await client.query(
      "INSERT INTO public.schema_migrations (name) VALUES ($1)",
      [name],
    );
  }
  await client.query("COMMIT");
  console.log("TrackFusionWeb database schema initialized successfully");
} catch (error) {
  if (client) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original initialization error below.
    }
  }
  console.error("Unable to initialize TrackFusionWeb database:", error.message);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
