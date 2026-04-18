import { GoogleGenerativeAI } from "@google/generative-ai";
import { contractToPrompt } from "../prompt/contract-to-prompt.js";
import { fewShotExamples } from "../prompt/few-shot.js";
import { validatePlan } from "../prompt/plan-validate.js";
import { planToSQL } from "../prompt/plan-to-sql.js";
import { runReadOnly } from "../db/executor.js";
import { CONTRACT } from "../db/contract.js";
import {
  getRecommendations,
  getPersonalizedRecommendations,
} from "../prompt/recommendation.js";
import { buildSystemPrompt } from "../prompt/prompt-system.js";
import { getConfig } from "../config/config-manager.js";
import { MESSAGES } from "../constants/messages.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const DEBUG_RESPONSE = process.env.CHATBOT_DEBUG_RESPONSE === "true";
const FALLBACK_MODEL = "gemini-2.0-flash";

const HISTORY_BUDGETS = {
  planner: {
    maxMessages: 4,
    maxCharsPerMessage: 200,
    maxTotalChars: 800,
  },
  reply: {
    maxMessages: 6,
    maxCharsPerMessage: 280,
    maxTotalChars: 1400,
  },
};

const QUICK_RECOMMEND_PROMPTS = new Set([
  "goiysanphamchominh",
  "goiychominh",
  "tuvangiup",
  "cogihay",
  "cogihaykhong",
  "dexuatchominh",
  "dexuatchotoi",
]);

function getModelName(config) {
  return config?.ai?.model || process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

function getShopName(config) {
  return config?.shopInfo?.name || "Hozitech";
}

function withTimeout(promise, timeoutMs, errorMessage = "GEMINI_TIMEOUT") {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function normalizeLooseText(input = "") {
  return String(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function clipText(input, maxChars) {
  const normalized = String(input || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function trimChatHistory(history, budget) {
  const normalized = (Array.isArray(history) ? history : [])
    .map((message) => {
      const role = message?.role === "bot" ? "bot" : message?.role === "user" ? "user" : null;
      if (!role) return null;
      const content = clipText(message?.content, budget.maxCharsPerMessage);
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean)
    .slice(-budget.maxMessages);

  let remaining = budget.maxTotalChars;
  const kept = [];

  for (let index = normalized.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const message = normalized[index];
    const clipped = clipText(message.content, Math.min(message.content.length, remaining));
    if (!clipped) continue;
    kept.unshift({ ...message, content: clipped });
    remaining -= clipped.length;
  }

  return kept;
}

function formatGeminiHistory(history) {
  return history.map((message) => ({
    role: message.role === "bot" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}

async function callGemini(
  systemInstruction,
  history,
  userMessage,
  jsonMode = false,
  options = {},
) {
  const temperature = options.temperature ?? 0.7;
  const maxRetries = options.maxRetries ?? 3;
  const modelsToTry =
    Array.isArray(options.modelsToTry) && options.modelsToTry.length > 0
      ? options.modelsToTry
      : [
        options.modelName || process.env.GEMINI_MODEL || FALLBACK_MODEL,
        FALLBACK_MODEL,
      ];
  const timeoutMs =
    options.timeoutMs ?? (Number(process.env.GEMINI_TIMEOUT_MS) || 25000);
  let lastError = null;

  const generationConfig = jsonMode
    ? { responseMimeType: "application/json", temperature }
    : { temperature };

  for (const modelName of modelsToTry) {
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
      try {
        const startedAt = Date.now();
        console.log(`[GEMINI START] model=${modelName} json=${jsonMode}`);
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction,
          generationConfig,
        });
        const chat = model.startChat({ history: formatGeminiHistory(history) });
        const result = await withTimeout(chat.sendMessage(userMessage), timeoutMs);
        console.log(
          `[GEMINI DONE] model=${modelName} ms=${Date.now() - startedAt}`,
        );
        return result.response.text();
      } catch (error) {
        lastError = error;
        const status = error?.status || error?.response?.status;
        const isTimeout = error?.message === "GEMINI_TIMEOUT";
        const isRetryable =
          status === 503 ||
          status === 429 ||
          isTimeout ||
          error?.code === "ECONNREFUSED";

        if (isRetryable && attempt < maxRetries) {
          const delay = Math.min(attempt * 1000, 3000);
          console.log(
            `[GEMINI RETRY] ${modelName} attempt ${attempt}/${maxRetries} (${status || error?.code || error?.message}), wait ${delay}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        if (isRetryable && modelName !== FALLBACK_MODEL && !options.modelName) {
          console.log(
            `[GEMINI FALLBACK] ${modelName} unavailable, switching to ${FALLBACK_MODEL}`,
          );
          break;
        }

        throw error;
      }
    }
  }

  throw lastError || new Error("GEMINI_UNAVAILABLE");
}

async function generatePlan(question, history, runtime) {
  const schemaText = contractToPrompt();
  const allowed = Object.keys(CONTRACT.resources).join(", ");
  const cfg = getConfig();
  const systemInstruction = MESSAGES.PLAN_SYSTEM(
    getShopName(cfg),
    schemaText,
    fewShotExamples,
    allowed,
  );

  const text = await callGemini(systemInstruction, history, question, true, {
    timeoutMs: cfg?.ai?.planTimeoutMs || 20000,
    maxRetries: cfg?.ai?.maxRetries ?? 2,
    modelName: runtime.modelName,
    temperature: runtime.temperature,
  });

  let parsed = {};
  try {
    parsed = JSON.parse(text || "{}");
  } catch {
    parsed = {};
  }

  if (parsed?.mode === "recommend") {
    return { mode: "recommend", intent: parsed.intent || "general" };
  }

  if (parsed?.resource) {
    return { mode: "db", plan: parsed };
  }

  return {
    mode: "non_db",
    message: parsed?.message?.trim() || MESSAGES.DEFAULT_HINT(getShopName(cfg)),
  };
}

function buildShortcutResult(userPrompt, shopName) {
  const normalized = normalizeLooseText(userPrompt);
  if (!normalized) return null;

  if (
    new Set(["chao", "xinchao", "hello", "hi", "alo", "banlaai"]).has(
      normalized,
    )
  ) {
    return {
      mode: "non_db",
      message: MESSAGES.GREETING(shopName),
      skipLlm: true,
    };
  }

  if (normalized === "sanphamnoibat") {
    return {
      mode: "db",
      skipLlm: true,
      plan: {
        resource: "Product",
        select: ["id", "name", "min_price", "total_stock", "category_name"],
        where: [
          { field: "is_featured", op: "eq", value: true },
          { field: "status", op: "eq", value: "ACTIVE" },
        ],
        sort: [{ field: "created_at", dir: "desc" }],
        limit: 5,
      },
    };
  }

  if (normalized === "dienthoaigiaduoi10trieu") {
    return {
      mode: "db",
      skipLlm: true,
      plan: {
        resource: "Product",
        joins: [{ resource: "Category" }],
        select: ["id", "name", "min_price", "total_stock", "category_name"],
        where: [
          { field: "Category.name", op: "contains", value: "điện thoại" },
          { field: "min_price", op: "lte", value: 10000000 },
          { field: "status", op: "eq", value: "ACTIVE" },
        ],
        sort: [{ field: "min_price", dir: "asc" }],
        limit: 5,
      },
    };
  }

  if (
    new Set(["comagiamgianaokhong", "comavouchernaokhong"]).has(normalized)
  ) {
    return {
      mode: "db",
      skipLlm: true,
      plan: {
        resource: "Coupon",
        select: [
          "code",
          "discount_type",
          "discount_value",
          "min_order_value",
          "end_date",
        ],
        where: [{ field: "status", op: "eq", value: "ACTIVE" }],
        sort: [{ field: "end_date", dir: "asc" }],
        limit: 5,
      },
    };
  }

  if (normalized === "goiysanphamchominh" || QUICK_RECOMMEND_PROMPTS.has(normalized)) {
    return {
      mode: "recommend",
      intent: "general",
      skipLlm: true,
    };
  }

  return null;
}

function isMissingReadModelError(error) {
  return (
    error?.code === "42P01" &&
    /v_chatbot_(products|product_variants|flash_sale_items|user_purchase_events)/.test(
      String(error?.message || ""),
    )
  );
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const numberValue = Number(value.replace(/,/g, ""));
    return Number.isFinite(numberValue) ? numberValue : null;
  }
  return null;
}

function formatCurrency(value) {
  const numberValue = toNumber(value);
  if (numberValue === null) return null;
  return `${Math.round(numberValue).toLocaleString("vi-VN")}đ`;
}

function pickFirst(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null && object?.[key] !== "") {
      return object[key];
    }
  }
  return null;
}

function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function formatProductLine(row, index) {
  const name =
    pickFirst(row, ["name", "product_name", "title"]) ||
    `${MESSAGES.PRODUCT_FALLBACK_NAME} ${index + 1}`;
  const price = pickFirst(row, ["min_price", "flash_price", "price", "origin_price"]);
  const stock = pickFirst(row, ["total_stock", "flash_stock", "stock_quantity"]);
  const category = pickFirst(row, ["category_name", "Category_name"]);
  const brand = pickFirst(row, ["brand_name", "Brand_name"]);
  const rating = pickFirst(row, ["avg_rating"]);
  const reviewCount = pickFirst(row, ["review_count"]);

  const parts = [`${index + 1}. **${name}**`];
  const formattedPrice = formatCurrency(price);
  if (formattedPrice) parts.push(`- ${formattedPrice}`);
  if (stock !== null) parts.push(`(tồn: ${stock})`);
  if (brand) parts.push(`- ${brand}`);
  if (category) parts.push(`- ${category}`);
  if (rating !== null) {
    parts.push(
      `- ⭐ ${rating}${reviewCount !== null ? ` (${reviewCount} đánh giá)` : ""}`,
    );
  }

  return parts.join(" ");
}

function formatVariantLine(row, index) {
  const productName =
    pickFirst(row, ["product_name", "Product_name", "name"]) ||
    `${MESSAGES.PRODUCT_FALLBACK_NAME} ${index + 1}`;
  const displayName = pickFirst(row, ["display_name"]);
  const attributeSummary = pickFirst(row, ["attribute_summary"]);
  const price = pickFirst(row, ["flash_price", "price", "compare_at_price"]);
  const stock = pickFirst(row, ["flash_stock", "stock_quantity"]);

  const detailParts = [];
  if (displayName && displayName !== productName) detailParts.push(displayName);
  if (attributeSummary && !detailParts.includes(attributeSummary)) {
    detailParts.push(attributeSummary);
  }

  const parts = [`${index + 1}. **${productName}**`];
  if (detailParts.length) parts.push(`- ${detailParts.join(" | ")}`);
  const formattedPrice = formatCurrency(price);
  if (formattedPrice) parts.push(`- ${formattedPrice}`);
  if (stock !== null) parts.push(`(tồn: ${stock})`);

  return parts.join(" ");
}

function formatProductDetail(row) {
  const name =
    pickFirst(row, ["name", "product_name", "title"]) ||
    MESSAGES.PRODUCT_FALLBACK_NAME;
  const price = pickFirst(row, ["min_price", "flash_price", "price", "origin_price"]);
  const originPrice = toNumber(row.origin_price);
  const stock = pickFirst(row, ["total_stock", "flash_stock", "stock_quantity"]);
  const category = pickFirst(row, ["category_name", "Category_name"]);
  const brand = pickFirst(row, ["brand_name", "Brand_name"]);
  const rating = pickFirst(row, ["avg_rating"]);
  const reviewCount = pickFirst(row, ["review_count"]);
  const rawDescription = row.description || null;
  const specSummary = row.spec_summary || null;

  const lines = [`**${name}**`, ""];

  if (brand) lines.push(`🏷️ Thương hiệu: **${brand}**`);
  if (category) lines.push(`📂 Danh mục: ${category}`);

  const formattedPrice = formatCurrency(price);
  const formattedOrigin = formatCurrency(originPrice);
  if (formattedPrice) {
    let priceLine = `💰 Giá: **${formattedPrice}**`;
    if (formattedOrigin && originPrice !== toNumber(price)) {
      priceLine += ` ~~${formattedOrigin}~~`;
    }
    lines.push(priceLine);
  }

  if (stock !== null) lines.push(`📦 Tồn kho: ${stock}`);
  if (rating !== null) {
    lines.push(
      `⭐ Đánh giá: ${rating}/5${reviewCount ? ` (${reviewCount} lượt)` : ""}`,
    );
  }

  if (rawDescription) {
    const clean = stripHtml(rawDescription);
    if (clean) {
      const shortDescription =
        clean.length > 220 ? `${clean.slice(0, 220).trimEnd()}...` : clean;
      lines.push(`\n📝 **Mô tả:**\n\n${shortDescription}`);
    }
  }

  if (specSummary) {
    const specLines = String(specSummary)
      .split(/\n+/)
      .map((line) => stripHtml(line))
      .filter(Boolean)
      .slice(0, 8)
      .map((line) => `- ${line}`);
    if (specLines.length) {
      lines.push(`\n⚙️ **Thông số kỹ thuật:**\n\n${specLines.join("\n")}`);
    }
  }

  return lines.join("\n");
}

function formatGenericLine(row, index) {
  const keys = Object.keys(row || {}).slice(0, 4);
  const details = keys
    .map((key) => {
      const rawValue = row[key];
      if (rawValue === null || rawValue === undefined || rawValue === "") return null;
      const maybePrice = /price|amount|total/i.test(key)
        ? formatCurrency(rawValue)
        : null;
      return `${key}: ${maybePrice || rawValue}`;
    })
    .filter(Boolean)
    .join(" | ");

  return `${index + 1}. ${details || "Không có dữ liệu hiển thị"}`;
}

function buildDbAnswer(userPrompt, resource, rows, maxProducts = 3) {
  if (!rows?.length) {
    return MESSAGES.NO_DATA(userPrompt);
  }

  if (resource === "Product" && rows.length === 1) {
    return formatProductDetail(rows[0]);
  }

  const sliced = rows.slice(0, maxProducts);
  let lines;

  if (resource === "ProductVariant") {
    lines = sliced.map((row, index) => formatVariantLine(row, index));
  } else if (resource === "Product") {
    lines = sliced.map((row, index) => formatProductLine(row, index));
  } else {
    lines = sliced.map((row, index) => formatGenericLine(row, index));
  }

  return `${MESSAGES.RESULT_HEADER(sliced.length, userPrompt)}\n${lines.join("\n")}`;
}

function formatDateTime(input) {
  if (!input) return null;
  const dateValue = new Date(input);
  if (Number.isNaN(dateValue.getTime())) return String(input);
  return dateValue.toLocaleString("vi-VN");
}

function buildRecommendationAnswer(recommendations, maxProducts = 3) {
  const sections = [];
  const isPersonalized = recommendations?._personalized === true;
  const labels = recommendations?._labels || {};

  if (isPersonalized) {
    const personalizedKeys = [
      "sameCategory",
      "sameBrand",
      "coPurchase",
      "budgetMatch",
    ];
    for (const key of personalizedKeys) {
      if (recommendations[key]?.length) {
        const lines = recommendations[key]
          .slice(0, maxProducts)
          .map((row, index) => formatProductLine(row, index));
        sections.push(`**🎯 ${labels[key] || key}**\n${lines.join("\n")}`);
      }
    }
  }

  if (recommendations?.featured?.length) {
    const lines = recommendations.featured
      .slice(0, maxProducts)
      .map((row, index) => formatProductLine(row, index));
    sections.push(`**${MESSAGES.SECTION_FEATURED}**\n${lines.join("\n")}`);
  }

  if (recommendations?.topRated?.length) {
    const lines = recommendations.topRated
      .slice(0, maxProducts)
      .map((row, index) => formatProductLine(row, index));
    sections.push(`**${MESSAGES.SECTION_TOP_RATED}**\n${lines.join("\n")}`);
  }

  if (recommendations?.flashSales?.length) {
    const lines = recommendations.flashSales
      .slice(0, maxProducts)
      .map((row, index) => {
        const productName =
          pickFirst(row, ["product_name", "display_name"]) ||
          MESSAGES.PRODUCT_FALLBACK_NAME;
        const detailParts = [];
        if (row.display_name && row.display_name !== productName) {
          detailParts.push(row.display_name);
        }
        if (row.attribute_summary && !detailParts.includes(row.attribute_summary)) {
          detailParts.push(row.attribute_summary);
        }
        const price = formatCurrency(row.flash_price);
        const end = formatDateTime(row.end_time);
        return `${index + 1}. **${productName}**${detailParts.length ? ` - ${detailParts.join(" | ")}` : ""}${price ? ` - ${price}` : ""}${row.flash_stock !== undefined ? ` (còn: ${row.flash_stock})` : ""}${end ? ` - hết hạn: ${end}` : ""}`;
      });
    sections.push(`**${MESSAGES.SECTION_FLASH_SALE}**\n${lines.join("\n")}`);
  }

  if (!sections.length) {
    return MESSAGES.RECOMMEND_EMPTY;
  }

  const header = isPersonalized
    ? MESSAGES.RECOMMEND_PERSONAL_HEADER
    : MESSAGES.RECOMMEND_HEADER;
  return `${header}\n\n${sections.join("\n\n")}`;
}

export const chatbot = async (req, res) => {
  try {
    const appConfig = getConfig();
    const runtime = {
      modelName: getModelName(appConfig),
      temperature: appConfig.ai?.temperature ?? 0.7,
      maxProducts: appConfig.ai?.maxProducts ?? 3,
      dbTimeoutMs: appConfig.ai?.dbTimeoutMs ?? 6000,
    };

    if (appConfig.isEnabled === false) {
      return res.status(200).json({
        answer: MESSAGES.DISABLED,
        mode: "non_db",
      });
    }

    const userPrompt = String(req.body.prompt || "").trim();
    const rawHistory = Array.isArray(req.body.history) ? req.body.history : [];

    if (!userPrompt) {
      return res.status(400).json({ error: MESSAGES.EMPTY_PROMPT });
    }

    const plannerHistory = trimChatHistory(rawHistory, HISTORY_BUDGETS.planner);
    const replyHistory = trimChatHistory(rawHistory, HISTORY_BUDGETS.reply);
    const shortcut = buildShortcutResult(userPrompt, getShopName(appConfig));
    const planResult =
      shortcut || (await generatePlan(userPrompt, plannerHistory, runtime));
    const { mode, plan, message, skipLlm } = planResult;

    if (mode === "recommend") {
      const userId = req.userId || null;
      const recommendations = userId
        ? await getPersonalizedRecommendations(userId)
        : await getRecommendations();
      const answer = buildRecommendationAnswer(
        recommendations,
        runtime.maxProducts,
      );

      return res.status(200).json({
        answer,
        mode: "recommend",
        data: recommendations,
      });
    }

    if (mode === "non_db") {
      if (skipLlm) {
        return res.status(200).json({
          answer: message || MESSAGES.DEFAULT_HINT(getShopName(appConfig)),
          mode,
        });
      }

      try {
        const systemPrompt = buildSystemPrompt(userPrompt);
        const naturalAnswer = await callGemini(
          systemPrompt,
          replyHistory,
          userPrompt,
          false,
          {
            modelName: runtime.modelName,
            temperature: Math.min(runtime.temperature + 0.1, 1.0),
            maxRetries: 1,
            timeoutMs: appConfig.ai?.planTimeoutMs || 60000,
          },
        );

        return res.status(200).json({
          answer:
            naturalAnswer ||
            message ||
            MESSAGES.DEFAULT_HINT(getShopName(appConfig)),
          mode,
        });
      } catch (error) {
        console.warn("[NON_DB] AI fallback:", error.message);
        return res.status(200).json({
          answer: message || MESSAGES.DEFAULT_HINT(getShopName(appConfig)),
          mode,
        });
      }
    }

    console.log("[PLAN]", JSON.stringify(plan));
    if (plan.limit === undefined || plan.limit > runtime.maxProducts) {
      plan.limit = runtime.maxProducts;
    }

    const validPlan = validatePlan(plan);
    const { sql, params } = planToSQL(validPlan);
    console.log("[SQL]", sql, params);

    const result = await runReadOnly(sql, params, runtime.dbTimeoutMs);
    console.log(`[DB RESULT] rowCount=${result.rowCount}`);

    const answer = buildDbAnswer(
      userPrompt,
      validPlan.resource,
      result.rows,
      runtime.maxProducts,
    );

    const safeResponse = {
      answer,
      mode,
      resultCount: result.rowCount,
    };

    if (DEBUG_RESPONSE) {
      safeResponse.debug = {
        plan: validPlan,
        sql,
        params,
        rowCount: result.rowCount,
      };
    }

    return res.status(200).json(safeResponse);
  } catch (error) {
    console.error("[CHATBOT ERROR]", error);
    if (isMissingReadModelError(error)) {
      console.error(
        "[CHATBOT SCHEMA] Missing chatbot read-model views. Run `npm run db:init-read-models` in chatbot/ with writable DB credentials.",
      );
      const response = {
        answer: MESSAGES.ERR_DB_SYNCING,
        mode: "non_db",
      };

      if (DEBUG_RESPONSE) {
        response.debug = {
          error: "chatbot_read_models_missing",
          hint: "Run npm run db:init-read-models in chatbot/",
        };
      }

      return res.status(200).json(response);
    }

    if (
      error?.message === "RESOURCE_NOT_ALLOWED" ||
      error?.message === "SELECT_EMPTY"
    ) {
      return res.status(200).json({
        answer: MESSAGES.ERR_UNCLEAR,
        mode: "non_db",
      });
    }

    if (
      error?.message === "GEMINI_TIMEOUT" ||
      error?.message === "GEMINI_UNAVAILABLE"
    ) {
      return res.status(200).json({
        answer: MESSAGES.ERR_AI_BUSY,
        mode: "non_db",
      });
    }

    return res.status(500).json({ error: error.message });
  }
};
