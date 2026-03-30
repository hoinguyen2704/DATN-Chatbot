import {
  getConfig,
  updateConfig,
  resetConfig,
  getDefaults,
} from "../config/config-manager.js";

/**
 * GET /api/v1/chatbot/admin/config
 * Trả toàn bộ config hiện tại cho admin panel
 */
export const getAdminConfig = (_req, res) => {
  try {
    const config = getConfig();
    return res.status(200).json(config);
  } catch (e) {
    console.error("[ADMIN] getConfig error:", e.message);
    return res.status(500).json({ error: "Failed to read config" });
  }
};

/**
 * PUT /api/v1/chatbot/admin/config
 * Cập nhật config (partial update — chỉ gửi field cần thay đổi)
 *
 * Body ví dụ:
 * {
 *   "shopInfo": { "hotline": "1900-1234" },
 *   "bot": { "name": "TechBot" }
 * }
 */
export const updateAdminConfig = (req, res) => {
  try {
    const partial = req.body;

    if (!partial || typeof partial !== "object" || Object.keys(partial).length === 0) {
      return res.status(400).json({ error: "Request body must be a non-empty object" });
    }

    const updated = updateConfig(partial);
    return res.status(200).json({
      message: "Cập nhật cấu hình thành công",
      config: updated,
    });
  } catch (e) {
    console.error("[ADMIN] updateConfig error:", e.message);
    return res.status(500).json({ error: "Failed to update config" });
  }
};

/**
 * POST /api/v1/chatbot/admin/config/reset
 * Reset toàn bộ config về giá trị mặc định
 */
export const resetAdminConfig = (_req, res) => {
  try {
    const config = resetConfig();
    return res.status(200).json({
      message: "Đã khôi phục cấu hình mặc định",
      config,
    });
  } catch (e) {
    console.error("[ADMIN] resetConfig error:", e.message);
    return res.status(500).json({ error: "Failed to reset config" });
  }
};

/**
 * GET /api/v1/chatbot/admin/config/defaults
 * Trả giá trị mặc định (để admin xem/so sánh)
 */
export const getAdminDefaults = (_req, res) => {
  try {
    return res.status(200).json(getDefaults());
  } catch (e) {
    console.error("[ADMIN] getDefaults error:", e.message);
    return res.status(500).json({ error: "Failed to read defaults" });
  }
};

/**
 * GET /api/v1/chatbot/admin/widget-config
 * Config công khai cho widget (không cần auth) — chỉ trả phần UI cần thiết
 */
export const getWidgetConfig = (_req, res) => {
  try {
    const config = getConfig();
    return res.status(200).json({
      bot: config.bot,
      suggestions: config.suggestions,
      isEnabled: config.isEnabled,
    });
  } catch (e) {
    return res.status(200).json({ isEnabled: true });
  }
};
