import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = path.join(__dirname, "settings.json");
const DEFAULTS_PATH = path.join(__dirname, "defaults.json");

/* ─── In-memory cache ─── */
let _cache = null;
let _defaults = null;

/**
 * Đọc và parse JSON file, trả {} nếu lỗi
 */
function readJSON(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Deep merge: source → target (overwrite)
 */
function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

/**
 * Lấy defaults (đọc 1 lần, cache lại)
 */
export function getDefaults() {
  if (!_defaults) {
    _defaults = readJSON(DEFAULTS_PATH);
  }
  return _defaults;
}

/**
 * Lấy config hiện tại (đọc từ cache hoặc file)
 */
export function getConfig() {
  if (!_cache) {
    const defaults = getDefaults();
    const settings = readJSON(SETTINGS_PATH);
    _cache = deepMerge(defaults, settings);
  }
  return _cache;
}

/**
 * Cập nhật config (partial update — deep merge)
 * @param {object} partial - Chỉ gửi các field cần thay đổi
 * @returns {object} Config sau khi cập nhật
 */
export function updateConfig(partial) {
  const current = getConfig();
  const updated = deepMerge(current, partial);

  // Ghi file
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2), "utf-8");

  // Cập nhật cache
  _cache = updated;

  console.log("[CONFIG] Settings updated successfully");
  return updated;
}

/**
 * Reset config về defaults
 * @returns {object} Config sau khi reset
 */
export function resetConfig() {
  const defaults = getDefaults();

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(defaults, null, 2), "utf-8");

  _cache = { ...defaults };

  console.log("[CONFIG] Settings reset to defaults");
  return _cache;
}
