import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import pg from "pg";

const { Pool } = pg;

const CHATBOT_DIR = path.resolve(import.meta.dirname, "..");
const REPO_DIR = path.resolve(CHATBOT_DIR, "..");
const SQL_FILES = [
  path.resolve(import.meta.dirname, "chatbot-read-models.sql"),
  path.resolve(import.meta.dirname, "init-chatbot-permissions.sql"),
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return dotenv.parse(fs.readFileSync(filePath, "utf-8"));
}

function parseJdbcLikeUrl(rawUrl) {
  if (!rawUrl) return null;

  try {
    const normalized = rawUrl.startsWith("jdbc:") ? rawUrl.slice(5) : rawUrl;
    const url = new URL(normalized);
    const database = url.pathname.replace(/^\/+/, "");
    if (!url.hostname || !database) return null;

    return {
      host: url.hostname,
      port: Number(url.port || 5432),
      database,
      user: decodeURIComponent(url.username || ""),
      password: decodeURIComponent(url.password || ""),
    };
  } catch {
    return null;
  }
}

function addCandidate(candidates, seen, label, config) {
  if (!config?.host || !config?.database || !config?.user) return;

  const normalized = {
    host: config.host,
    port: Number(config.port || 5432),
    database: config.database,
    user: config.user,
    password: config.password || "",
  };

  const key = [
    normalized.host,
    normalized.port,
    normalized.database,
    normalized.user,
  ].join(":");

  if (seen.has(key)) return;
  seen.add(key);
  candidates.push({ label, config: normalized });
}

function buildCandidates() {
  const serverEnv = {
    ...loadEnvFile(path.resolve(REPO_DIR, "server/.env")),
    ...loadEnvFile(path.resolve(REPO_DIR, "server/.env.dev")),
  };
  const chatbotEnv = loadEnvFile(path.resolve(CHATBOT_DIR, ".env"));
  const chatbotDevEnv = loadEnvFile(path.resolve(CHATBOT_DIR, ".env.development"));

  const candidates = [];
  const seen = new Set();

  const processBootstrapUrl =
    process.env.CHATBOT_DB_BOOTSTRAP_URL || process.env.DB_BOOTSTRAP_URL;
  const parsedProcessBootstrapUrl = parseJdbcLikeUrl(processBootstrapUrl);
  addCandidate(candidates, seen, "process bootstrap url", {
    ...parsedProcessBootstrapUrl,
    user:
      process.env.CHATBOT_DB_BOOTSTRAP_USER ||
      process.env.CHATBOT_DB_BOOTSTRAP_USERNAME ||
      parsedProcessBootstrapUrl?.user,
    password:
      process.env.CHATBOT_DB_BOOTSTRAP_PASSWORD ||
      parsedProcessBootstrapUrl?.password,
  });

  addCandidate(candidates, seen, "process bootstrap host config", {
    host: process.env.CHATBOT_DB_BOOTSTRAP_HOST,
    port: process.env.CHATBOT_DB_BOOTSTRAP_PORT,
    database: process.env.CHATBOT_DB_BOOTSTRAP_NAME,
    user:
      process.env.CHATBOT_DB_BOOTSTRAP_USER ||
      process.env.CHATBOT_DB_BOOTSTRAP_USERNAME,
    password: process.env.CHATBOT_DB_BOOTSTRAP_PASSWORD,
  });

  const parsedProcessDbUrl = parseJdbcLikeUrl(process.env.DB_URL);
  addCandidate(candidates, seen, "process DB_URL", {
    ...parsedProcessDbUrl,
    user: process.env.DB_USERNAME || parsedProcessDbUrl?.user,
    password: process.env.DB_PASSWORD || parsedProcessDbUrl?.password,
  });

  const parsedServerDbUrl = parseJdbcLikeUrl(serverEnv.DB_URL);
  addCandidate(candidates, seen, "server/.env DB_URL", {
    ...parsedServerDbUrl,
    user: serverEnv.DB_USERNAME || parsedServerDbUrl?.user,
    password: serverEnv.DB_PASSWORD || parsedServerDbUrl?.password,
  });

  addCandidate(candidates, seen, "chatbot DB with server credentials", {
    host: chatbotEnv.DB_HOST,
    port: chatbotEnv.DB_PORT,
    database: chatbotEnv.DB_NAME,
    user: serverEnv.DB_USERNAME,
    password: serverEnv.DB_PASSWORD,
  });

  if (
    chatbotDevEnv.DB_NAME &&
    chatbotDevEnv.DB_NAME !== chatbotEnv.DB_NAME &&
    serverEnv.DB_USERNAME
  ) {
    addCandidate(candidates, seen, "chatbot .env.development DB with server credentials", {
      host: chatbotDevEnv.DB_HOST || chatbotEnv.DB_HOST,
      port: chatbotDevEnv.DB_PORT || chatbotEnv.DB_PORT,
      database: chatbotDevEnv.DB_NAME,
      user: serverEnv.DB_USERNAME,
      password: serverEnv.DB_PASSWORD,
    });
  }

  addCandidate(candidates, seen, "chatbot runtime connection", {
    host: chatbotEnv.DB_HOST,
    port: chatbotEnv.DB_PORT,
    database: chatbotEnv.DB_NAME,
    user: chatbotEnv.DB_USER,
    password: chatbotEnv.DB_PASSWORD,
  });

  return candidates;
}

async function applySqlFile(client, sqlPath) {
  if (!fs.existsSync(sqlPath)) {
    throw new Error(`SQL file not found: ${sqlPath}`);
  }

  const sql = fs.readFileSync(sqlPath, "utf-8");
  await client.query(sql);
}

async function verifyViews(client) {
  const result = await client.query(`
    SELECT
      to_regclass('public.v_chatbot_products') AS v_chatbot_products,
      to_regclass('public.v_chatbot_product_variants') AS v_chatbot_product_variants,
      to_regclass('public.v_chatbot_flash_sale_items') AS v_chatbot_flash_sale_items,
      to_regclass('public.v_chatbot_user_purchase_events') AS v_chatbot_user_purchase_events
  `);

  const row = result.rows[0] || {};
  return Object.values(row).every(Boolean);
}

function describeError(error) {
  if (!error) return "Unknown error";

  const parts = [];
  if (error.code) parts.push(error.code);
  if (error.severity) parts.push(error.severity);
  if (error.address || error.port) {
    parts.push(
      [error.address, error.port].filter(Boolean).join(":"),
    );
  }
  if (error.message) parts.push(error.message);
  if (error.hint) parts.push(error.hint);

  return parts.filter(Boolean).join(" | ") || String(error);
}

async function tryApplyCandidate(candidate) {
  const pool = new Pool({
    ...candidate.config,
    max: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
  });

  let client = null;
  try {
    console.log(
      `🔌 Trying ${candidate.label}: ${candidate.config.host}:${candidate.config.port}/${candidate.config.database} as ${candidate.config.user}`,
    );
    client = await pool.connect();

    const identity = await client.query(
      "SELECT current_user, current_database() AS current_database",
    );
    const current = identity.rows[0] || {};
    console.log(
      `   Connected as ${current.current_user} to ${current.current_database}`,
    );

    for (const sqlPath of SQL_FILES) {
      await applySqlFile(client, sqlPath);
      console.log(`   Applied ${path.basename(sqlPath)}`);
    }

    const verified = await verifyViews(client);
    if (!verified) {
      throw new Error("Read-model views were not created successfully");
    }

    console.log("✅ Chatbot read-model views are ready.");
    return true;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function main() {
  const candidates = buildCandidates();
  if (!candidates.length) {
    throw new Error(
      "No writable PostgreSQL connection found. Set CHATBOT_DB_BOOTSTRAP_* or server DB_URL/DB_USERNAME/DB_PASSWORD.",
    );
  }

  const failures = [];

  for (const candidate of candidates) {
    try {
      const applied = await tryApplyCandidate(candidate);
      if (applied) return;
    } catch (error) {
      const message = describeError(error);
      failures.push(`- ${candidate.label}: ${message}`);
      console.warn(`   Failed ${candidate.label}: ${message}`);
    }
  }

  throw new Error(
    `Unable to apply chatbot read-model views.\n${failures.join("\n")}`,
  );
}

main().catch((error) => {
  console.error("❌", error.message);
  process.exit(1);
});
