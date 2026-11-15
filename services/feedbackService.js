import { queryToDatabase } from "./dbService.js";

export async function createFeedbackReport({
  userId,
  category,
  description,
  source,
  errorCode,
  referenceId,
  pagePath,
}) {
  const result = await queryToDatabase(
    `INSERT INTO feedback_reports
      (user_id, category, description, source, error_code, reference_id, page_path)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, created_at`,
    [
      userId,
      category,
      description,
      source,
      errorCode || null,
      referenceId || null,
      pagePath || null,
    ],
  );
  return result.rows[0];
}
