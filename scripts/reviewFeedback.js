import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const requestedLimit = Number.parseInt(process.argv[2] || "25", 10);
const limit = Number.isInteger(requestedLimit)
  ? Math.min(Math.max(requestedLimit, 1), 100)
  : 25;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required to review feedback");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const result = await pool.query(
    `SELECT id, created_at, user_id, category, source, error_code,
            reference_id, page_path, description
       FROM feedback_reports
      ORDER BY created_at DESC, id DESC
      LIMIT $1`,
    [limit],
  );

  if (result.rows.length === 0) {
    console.log("No feedback reports found.");
  } else {
    for (const report of result.rows) {
      console.log(JSON.stringify(report));
    }
  }
} catch (error) {
  console.error(`Unable to review feedback: ${error.message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
