import pg from "pg";

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

const DEFAULT_QUERY_TIMEOUT_MS = 6000;
const MIN_QUERY_TIMEOUT_MS = 1000;
const MAX_QUERY_TIMEOUT_MS = 30000;

function normalizeQueryTimeoutMs(value) {
  const timeoutMs = Number(value);
  if (!Number.isFinite(timeoutMs)) return DEFAULT_QUERY_TIMEOUT_MS;
  return Math.min(
    Math.max(Math.trunc(timeoutMs), MIN_QUERY_TIMEOUT_MS),
    MAX_QUERY_TIMEOUT_MS,
  );
}

/**
 * Thực thi SQL trong transaction READ ONLY với timeout.
 * Đảm bảo chatbot không thể ghi/xóa dữ liệu.
 */
export async function runReadOnly(
  sql,
  params = [],
  queryTimeoutMs = DEFAULT_QUERY_TIMEOUT_MS,
) {
  const client = await pool.connect();
  try {
    const safeQueryTimeoutMs = normalizeQueryTimeoutMs(queryTimeoutMs);
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      `${safeQueryTimeoutMs}ms`,
    ]);

    const result = await client.query(sql, params);

    await client.query("COMMIT");

    return {
      rowCount: result.rowCount,
      rows: result.rows,
      columns: result.fields?.map((f) => f.name),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[PG ERROR]", err.message);
    throw err;
  } finally {
    client.release();
  }
}
