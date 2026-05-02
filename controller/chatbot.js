import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
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
let openAIClient = null;
const DEBUG_RESPONSE = process.env.CHATBOT_DEBUG_RESPONSE === "true";
const FALLBACK_MODEL = "gemini-3-flash-preview";
const OPENAI_FALLBACK_MODEL = "gpt-5.4-mini";

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

const COMPARISON_INTENT_PATTERN =
  /(so sánh|so với|\bvs\.?\b|nên mua|nên chọn|chọn giữa|khác nhau|đáng mua hơn|tốt hơn)/i;
const COMPARISON_SPLITTERS = [
  /\s+so với\s+/i,
  /\s+\bvs\.?\b\s+/i,
  /\s+với\s+/i,
  /\s+hay\s+/i,
  /\s+và\s+/i,
];

function cleanupComparisonTerm(term = "") {
  return String(term || "")
    .replace(/^[\s"'“”‘’,.:;!?()[\]-]+|[\s"'“”‘’,.:;!?()[\]-]+$/g, "")
    .replace(
      /^(so sánh|so với|compare|giữa|nên mua|nên chọn|chọn giữa|chọn|giúp mình so sánh|giup minh so sanh|tư vấn|tu van)\s+/i,
      "",
    )
    .replace(
      /\s+(?:và|va)\s+(?:cho|giúp|giup|nói|noi|kèm|kem)\b.*$/i,
      "",
    )
    .replace(
      /\b(cái nào|mẫu nào|con nào|ưu nhược điểm|ưu điểm|nhược điểm|tốt hơn|ổn hơn|đáng mua hơn|nên mua cái nào|nên chọn cái nào|khác nhau chỗ nào|thì sao)\b.*$/i,
      "",
    )
    .replace(
      /\s+có\s+(?:thông số|cấu hình|điểm gì|điểm nào|điểm|điều gì|điều nào|điều|gì|những gì|tính năng)(?:\s+.*)?$/i,
      "",
    )
    .replace(
      /\s+(?:vượt trội|nổi bật|ấn tượng|đáng tiền|mạnh hơn|hơn ở điểm nào)(?:\s+.*)?$/i,
      "",
    )
    .replace(/\s+(nhé|nha|ạ|a|giùm|dum|giúp mình|giup minh)$/i, "")
    .trim();
}

function extractComparisonTerms(userPrompt = "") {
  const prompt = String(userPrompt || "").replace(/\s+/g, " ").trim();
  if (!prompt || !COMPARISON_INTENT_PATTERN.test(prompt)) {
    return [];
  }

  const working = prompt
    .replace(/^(giúp mình|giup minh|cho mình|cho minh|tư vấn|tu van)\s+/i, "")
    .replace(/^(so sánh|compare)\s+/i, "")
    .replace(/^(nên mua|nên chọn|chọn giữa)\s+/i, "");

  for (const splitter of COMPARISON_SPLITTERS) {
    const parts = working
      .split(splitter, 2)
      .map((part) => cleanupComparisonTerm(part))
      .filter(Boolean);
    const uniqueParts = [...new Set(parts)];
    if (uniqueParts.length >= 2) {
      return uniqueParts.slice(0, 2);
    }
  }

  return [];
}

function getModelName(config) {
  const provider = getAIProvider(config);
  if (provider === "openai") {
    return (
      config?.ai?.model ||
      process.env.OPENAI_MODEL ||
      process.env.CHATBOT_AI_MODEL ||
      OPENAI_FALLBACK_MODEL
    );
  }

  return (
    config?.ai?.model ||
    process.env.GEMINI_MODEL ||
    process.env.CHATBOT_AI_MODEL ||
    FALLBACK_MODEL
  );
}

function getEnvProvider() {
  const provider = String(
    process.env.CHATBOT_AI_PROVIDER ||
      process.env.AI_PROVIDER ||
      process.env.LLM_PROVIDER ||
      "",
  )
    .trim()
    .toLowerCase();

  return provider === "openai" || provider === "gemini" ? provider : null;
}

function getConfiguredProvider(config) {
  const provider = String(config?.ai?.provider || "").trim().toLowerCase();
  return provider === "openai" || provider === "gemini" ? provider : null;
}

function isOpenAIModel(modelName = "") {
  return /^(gpt-|o\d|o-|chatgpt-)/i.test(String(modelName).trim());
}

function getAIProvider(config, modelName) {
  const configuredProvider = getConfiguredProvider(config);
  if (configuredProvider) return configuredProvider;
  if (modelName && isOpenAIModel(modelName)) return "openai";
  const envProvider = getEnvProvider();
  if (envProvider) return envProvider;
  if (
    isOpenAIModel(process.env.OPENAI_MODEL || process.env.CHATBOT_AI_MODEL || "")
  ) {
    return "openai";
  }
  return "gemini";
}

function getErrorStatus(error) {
  return error?.status || error?.response?.status;
}

function getOpenAIErrorCode(error) {
  return error?.code || error?.error?.code;
}

function shouldFallbackToGemini(error) {
  const status = getErrorStatus(error);
  const code = getOpenAIErrorCode(error);
  const message = String(error?.message || error?.error?.message || "");

  return (
    error?.message === "OPENAI_API_KEY_MISSING" ||
    error?.message === "OPENAI_TIMEOUT" ||
    status === 429 ||
    code === "insufficient_quota" ||
    code === "rate_limit_exceeded" ||
    /quota|rate limit|billing|token/i.test(message)
  );
}

function getGeminiFallbackModels() {
  return [...new Set([process.env.GEMINI_MODEL || FALLBACK_MODEL, FALLBACK_MODEL])];
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

function formatOpenAIInput(history, userMessage) {
  return [
    ...history.map((message) => ({
      role: message.role === "bot" ? "assistant" : "user",
      content: message.content,
    })),
    {
      role: "user",
      content: userMessage,
    },
  ];
}

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY_MISSING");
  }

  if (!openAIClient) {
    openAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  return openAIClient;
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

async function callOpenAI(
  systemInstruction,
  history,
  userMessage,
  jsonMode = false,
  options = {},
) {
  const client = getOpenAIClient();
  const modelName = options.modelName || process.env.OPENAI_MODEL || OPENAI_FALLBACK_MODEL;
  const temperature = options.temperature ?? 0.7;
  const maxRetries = options.maxRetries ?? 3;
  const timeoutMs =
    options.timeoutMs ?? (Number(process.env.OPENAI_TIMEOUT_MS) || 25000);
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const startedAt = Date.now();
      console.log(`[OPENAI START] model=${modelName} json=${jsonMode}`);
      const request = {
        model: modelName,
        instructions: systemInstruction,
        input: formatOpenAIInput(
          history,
          jsonMode
            ? `${userMessage}\n\nReturn only valid json. Do not include markdown fences or extra text.`
            : userMessage,
        ),
        store: process.env.OPENAI_STORE_RESPONSES === "true",
        temperature,
      };

      if (jsonMode) {
        request.text = { format: { type: "json_object" } };
      }

      const result = await withTimeout(
        client.responses.create(request),
        timeoutMs,
        "OPENAI_TIMEOUT",
      );
      console.log(
        `[OPENAI DONE] model=${modelName} ms=${Date.now() - startedAt}`,
      );
      return result.output_text || "";
    } catch (error) {
      lastError = error;
      const status = getErrorStatus(error);
      const errorCode = getOpenAIErrorCode(error);
      const isTimeout = error?.message === "OPENAI_TIMEOUT";
      const isRetryable =
        errorCode !== "insufficient_quota" &&
        (status === 429 ||
          status === 500 ||
          status === 502 ||
          status === 503 ||
          status === 504 ||
          isTimeout ||
          ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT"].includes(error?.code));

      if (isRetryable && attempt < maxRetries) {
        const delay = Math.min(attempt * 1000, 3000);
        console.log(
          `[OPENAI RETRY] ${modelName} attempt ${attempt}/${maxRetries} (${status || error?.code || error?.message}), wait ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      throw error;
    }
  }

  throw lastError || new Error("OPENAI_UNAVAILABLE");
}

async function callAI(
  systemInstruction,
  history,
  userMessage,
  jsonMode = false,
  options = {},
) {
  if (options.provider === "openai") {
    try {
      return await callOpenAI(
        systemInstruction,
        history,
        userMessage,
        jsonMode,
        options,
      );
    } catch (error) {
      if (!shouldFallbackToGemini(error)) {
        throw error;
      }

      const fallbackModels = getGeminiFallbackModels();
      console.warn(
        `[OPENAI FALLBACK] ${options.modelName || OPENAI_FALLBACK_MODEL} failed (${getOpenAIErrorCode(error) || getErrorStatus(error) || error.message}), switching to ${fallbackModels[0]}`,
      );

      return callGemini(systemInstruction, history, userMessage, jsonMode, {
        ...options,
        modelName: fallbackModels[0],
        modelsToTry: fallbackModels,
      });
    }
  }

  return callGemini(systemInstruction, history, userMessage, jsonMode, options);
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

  const text = await callAI(systemInstruction, history, question, true, {
    timeoutMs: cfg?.ai?.planTimeoutMs || 20000,
    maxRetries: cfg?.ai?.maxRetries ?? 2,
    modelName: runtime.modelName,
    provider: runtime.provider,
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

  const comparisonTerms = extractComparisonTerms(userPrompt);
  if (comparisonTerms.length === 2) {
    return {
      mode: "compare",
      terms: comparisonTerms,
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

function formatRatingSummary(row) {
  const rating = toNumber(row?.avg_rating);
  const reviewCount = toNumber(row?.review_count);
  if (rating === null) return "Chưa có đánh giá";
  return `${rating}/5${reviewCount !== null ? ` (${reviewCount} đánh giá)` : ""}`;
}

function getSpecHighlights(specSummary, limit = 3) {
  return String(specSummary || "")
    .split(/\n+/)
    .map((line) => stripHtml(line).replace(/^[-*•]\s*/, ""))
    .filter(Boolean)
    .slice(0, limit);
}

function buildRelativeNotes(primary, secondary) {
  const advantages = [];
  const considerations = [];

  const primaryPrice = toNumber(primary?.min_price);
  const secondaryPrice = toNumber(secondary?.min_price);
  if (primaryPrice !== null && secondaryPrice !== null) {
    if (primaryPrice < secondaryPrice) {
      const gap = secondaryPrice - primaryPrice;
      advantages.push(
        `Giá thấp hơn ${secondary.name}${gap > 0 ? ` khoảng ${formatCurrency(gap)}` : ""}.`,
      );
    } else if (primaryPrice > secondaryPrice) {
      const gap = primaryPrice - secondaryPrice;
      considerations.push(
        `Giá cao hơn ${secondary.name}${gap > 0 ? ` khoảng ${formatCurrency(gap)}` : ""}.`,
      );
    }
  }

  const primaryRating = toNumber(primary?.avg_rating);
  const secondaryRating = toNumber(secondary?.avg_rating);
  if (primaryRating !== null && secondaryRating !== null) {
    if (primaryRating > secondaryRating) {
      advantages.push(
        `Điểm đánh giá cao hơn (${primaryRating}/5 so với ${secondaryRating}/5).`,
      );
    } else if (primaryRating < secondaryRating) {
      considerations.push(
        `Điểm đánh giá thấp hơn (${primaryRating}/5 so với ${secondaryRating}/5).`,
      );
    }
  }

  const primaryReviews = toNumber(primary?.review_count);
  const secondaryReviews = toNumber(secondary?.review_count);
  if (primaryReviews !== null && secondaryReviews !== null) {
    if (primaryReviews > secondaryReviews) {
      advantages.push(
        `Có nhiều lượt đánh giá hơn (${primaryReviews} so với ${secondaryReviews}).`,
      );
    } else if (primaryReviews < secondaryReviews) {
      considerations.push(
        `Ít lượt đánh giá hơn (${primaryReviews} so với ${secondaryReviews}).`,
      );
    }
  }

  const primaryStock = toNumber(primary?.total_stock);
  const secondaryStock = toNumber(secondary?.total_stock);
  if (primaryStock !== null && secondaryStock !== null) {
    if (primaryStock > secondaryStock) {
      advantages.push(
        `Tồn kho sẵn hàng hơn (${primaryStock} so với ${secondaryStock}).`,
      );
    } else if (primaryStock < secondaryStock) {
      considerations.push(
        `Tồn kho thấp hơn (${primaryStock} so với ${secondaryStock}).`,
      );
    }
  }

  const specHighlights = getSpecHighlights(primary?.spec_summary, 2);
  if (specHighlights.length) {
    advantages.push(`Thông số nổi bật: ${specHighlights.join("; ")}.`);
  }

  return { advantages, considerations };
}

function buildBulletSection(title, items, fallback) {
  const lines = items?.length ? items.map((item) => `- ${item}`) : [`- ${fallback}`];
  return `**${title}**\n${lines.join("\n")}`;
}

function buildComparisonAnswer(leftProduct, rightProduct) {
  const leftName = leftProduct?.name || MESSAGES.PRODUCT_FALLBACK_NAME;
  const rightName = rightProduct?.name || MESSAGES.PRODUCT_FALLBACK_NAME;
  const leftPrice = formatCurrency(leftProduct?.min_price) || "Chưa có giá";
  const rightPrice = formatCurrency(rightProduct?.min_price) || "Chưa có giá";
  const leftStock = toNumber(leftProduct?.total_stock);
  const rightStock = toNumber(rightProduct?.total_stock);
  const leftNotes = buildRelativeNotes(leftProduct, rightProduct);
  const rightNotes = buildRelativeNotes(rightProduct, leftProduct);

  const summaryLines = [
    `- Giá thấp nhất: **${leftName}** ${leftPrice} | **${rightName}** ${rightPrice}`,
    `- Đánh giá: **${leftName}** ${formatRatingSummary(leftProduct)} | **${rightName}** ${formatRatingSummary(rightProduct)}`,
  ];

  if (leftStock !== null || rightStock !== null) {
    summaryLines.push(
      `- Tồn kho: **${leftName}** ${leftStock ?? "N/A"} | **${rightName}** ${rightStock ?? "N/A"}`,
    );
  }

  return [
    `**So sánh nhanh: ${leftName} và ${rightName}**`,
    "",
    ...summaryLines,
    "",
    buildBulletSection(
      `Ưu điểm tương đối của ${leftName}`,
      leftNotes.advantages,
      "Chưa có thêm dữ liệu nổi trội để kết luận rõ hơn.",
    ),
    "",
    buildBulletSection(
      `Điểm cần cân nhắc của ${leftName}`,
      leftNotes.considerations,
      "Chưa thấy bất lợi rõ ràng từ dữ liệu hiện có.",
    ),
    "",
    buildBulletSection(
      `Ưu điểm tương đối của ${rightName}`,
      rightNotes.advantages,
      "Chưa có thêm dữ liệu nổi trội để kết luận rõ hơn.",
    ),
    "",
    buildBulletSection(
      `Điểm cần cân nhắc của ${rightName}`,
      rightNotes.considerations,
      "Chưa thấy bất lợi rõ ràng từ dữ liệu hiện có.",
    ),
  ].join("\n");
}

async function findBestMatchingProduct(term, queryTimeoutMs = 6000) {
  const normalizedTerm = cleanupComparisonTerm(term);
  if (!normalizedTerm) return null;

  const flexibleLike = `%${normalizedTerm.replace(/\s+/g, "%")}%`;
  const prefixLike = `${normalizedTerm.replace(/\s+/g, "%")}%`;
  const sql = `
    SELECT
      id,
      name,
      slug,
      description,
      origin_price,
      min_price,
      max_price,
      total_stock,
      avg_rating,
      review_count,
      spec_summary,
      brand_name,
      category_name,
      created_at
    FROM v_chatbot_products
    WHERE status = 'ACTIVE'
      AND (
        name ILIKE $1
        OR COALESCE(spec_summary, '') ILIKE $1
        OR COALESCE(description, '') ILIKE $1
      )
    ORDER BY
      CASE
        WHEN LOWER(name) = LOWER($2) THEN 0
        WHEN LOWER(name) LIKE LOWER($3) THEN 1
        ELSE 2
      END,
      review_count DESC NULLS LAST,
      avg_rating DESC NULLS LAST,
      total_stock DESC NULLS LAST,
      created_at DESC
    LIMIT 1
  `;

  const result = await runReadOnly(
    sql,
    [flexibleLike, normalizedTerm, prefixLike],
    queryTimeoutMs,
  );

  return result.rows?.[0] || null;
}

async function resolveComparisonProducts(terms, queryTimeoutMs = 6000) {
  const normalizedTerms = Array.isArray(terms)
    ? terms.map((term) => cleanupComparisonTerm(term)).filter(Boolean)
    : [];

  if (normalizedTerms.length < 2) {
    return { products: [], missingTerms: normalizedTerms };
  }

  const matches = await Promise.all(
    normalizedTerms.map((term) => findBestMatchingProduct(term, queryTimeoutMs)),
  );

  const products = [];
  const missingTerms = [];
  const seenIds = new Set();

  matches.forEach((match, index) => {
    if (!match) {
      missingTerms.push(normalizedTerms[index]);
      return;
    }
    if (seenIds.has(match.id)) {
      missingTerms.push(normalizedTerms[index]);
      return;
    }
    seenIds.add(match.id);
    products.push(match);
  });

  return { products, missingTerms };
}

function buildComparisonFallbackAnswer(terms, products, missingTerms) {
  if (!products.length) {
    return `Mình chưa xác định được đủ hai sản phẩm trong câu hỏi "${terms.join(" và ")}". Bạn hãy ghi rõ lại tên từng sản phẩm để mình so sánh chính xác hơn.`;
  }

  const foundNames = products.map((product) => product.name).join(" và ");
  if (missingTerms.length) {
    return `Mình mới khớp được ${foundNames}. Chưa tìm thấy rõ sản phẩm còn lại (${missingTerms.join(", ")}), nên chưa thể so sánh chuẩn.`;
  }

  return `Mình chưa xác định được đủ hai sản phẩm khác nhau để so sánh. Bạn hãy ghi rõ lại tên từng sản phẩm giúp mình.`;
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
    const modelName = getModelName(appConfig);
    const runtime = {
      modelName,
      provider: getAIProvider(appConfig, modelName),
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
    const { mode, plan, message, skipLlm, terms } = planResult;

    if (mode === "compare") {
      const { products, missingTerms } = await resolveComparisonProducts(
        terms,
        runtime.dbTimeoutMs,
      );
      const answer =
        products.length === 2
          ? buildComparisonAnswer(products[0], products[1])
          : buildComparisonFallbackAnswer(terms || [], products, missingTerms);

      return res.status(200).json({
        answer,
        mode: "db",
        resultCount: products.length,
        data: products,
      });
    }

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
        const naturalAnswer = await callAI(
          systemPrompt,
          replyHistory,
          userPrompt,
          false,
          {
            modelName: runtime.modelName,
            provider: runtime.provider,
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
      error?.message === "GEMINI_UNAVAILABLE" ||
      error?.message === "OPENAI_TIMEOUT" ||
      error?.message === "OPENAI_UNAVAILABLE" ||
      error?.message === "OPENAI_API_KEY_MISSING"
    ) {
      return res.status(200).json({
        answer: MESSAGES.ERR_AI_BUSY,
        mode: "non_db",
      });
    }

    return res.status(500).json({ error: error.message });
  }
};
