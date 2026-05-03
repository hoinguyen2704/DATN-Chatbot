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

const SUPPORTED_INTENTS = new Set([
  "compare_products",
  "recommend_products",
  "product_detail",
  "product_search",
  "variant_search",
  "flash_sale_lookup",
  "order_lookup",
  "coupon_lookup",
  "article_lookup",
  "support_handoff",
  "non_db",
]);

const INTENT_RESOURCE_MAP = {
  compare_products: "Product",
  product_detail: "Product",
  product_search: "Product",
  variant_search: "ProductVariant",
  flash_sale_lookup: "FlashSaleItem",
  order_lookup: "Order",
  coupon_lookup: "Coupon",
  article_lookup: "Article",
};

const RESPONSE_SYNTHESIS_INTENTS = new Set([
  "product_detail",
  "product_search",
  "compare_products",
  "recommend_products",
  "article_lookup",
]);

const CATEGORY_HINTS = [
  { match: "dienthoai", value: "điện thoại" },
  { match: "laptop", value: "laptop" },
  { match: "maytinhbang", value: "máy tính bảng" },
  { match: "tablet", value: "tablet" },
  { match: "manhinh", value: "màn hình" },
  { match: "tainghe", value: "tai nghe" },
  { match: "chuot", value: "chuột" },
  { match: "banphim", value: "bàn phím" },
  { match: "dongho", value: "đồng hồ" },
  { match: "loa", value: "loa" },
];

const COMPARISON_INTENT_PATTERN =
  /(so sánh|so với|\bvs\.?\b|nên mua|nên chọn|chọn giữa|khác nhau|đáng mua hơn|tốt hơn)/i;
const COMPARISON_SPLITTERS = [
  /\s+so với\s+/i,
  /\s+\bvs\.?\b\s+/i,
  /\s+với\s+/i,
  /\s+hay\s+/i,
  /\s+và\s+/i,
];
const ORDER_NUMBER_PATTERN = /\bORD-[A-Z0-9-]+\b/i;

const ORDER_STATUS_LABELS = {
  PENDING: "chờ xác nhận",
  CONFIRMED: "đã xác nhận",
  PROCESSING: "đang xử lý",
  SHIPPING: "đang giao",
  SHIPPED: "đã giao",
  CANCELLED: "đã hủy",
  RETURNED: "đã hoàn trả",
};

const PAYMENT_STATUS_LABELS = {
  PENDING: "chờ thanh toán",
  COMPLETED: "đã thanh toán",
  FAILED: "thanh toán thất bại",
  REFUNDED: "đã hoàn tiền",
};

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

function looksLikeUuid(value = "") {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}

function extractOrderNumber(...inputs) {
  for (const input of inputs) {
    if (Array.isArray(input)) {
      const nested = extractOrderNumber(...input);
      if (nested) return nested;
      continue;
    }

    const match = String(input || "").match(ORDER_NUMBER_PATTERN);
    if (match?.[0]) {
      return match[0].toUpperCase();
    }
  }

  return null;
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

function normalizeIntent(rawIntent, rawMode) {
  const normalizedIntent = String(rawIntent || "").trim().toLowerCase();
  const normalizedMode = String(rawMode || "").trim().toLowerCase();

  const aliases = {
    compare: "compare_products",
    compare_products: "compare_products",
    product_compare: "compare_products",
    recommend: "recommend_products",
    recommend_products: "recommend_products",
    product_recommendation: "recommend_products",
    detail: "product_detail",
    product_detail: "product_detail",
    product_search: "product_search",
    search_products: "product_search",
    search: "product_search",
    variant_search: "variant_search",
    product_variant_search: "variant_search",
    flash_sale_lookup: "flash_sale_lookup",
    flashsale_lookup: "flash_sale_lookup",
    flash_sale_search: "flash_sale_lookup",
    order_lookup: "order_lookup",
    order_search: "order_lookup",
    lookup_order: "order_lookup",
    coupon_lookup: "coupon_lookup",
    coupon_search: "coupon_lookup",
    article_lookup: "article_lookup",
    article_search: "article_lookup",
    blog_lookup: "article_lookup",
    support_handoff: "support_handoff",
    support: "support_handoff",
    handoff_support: "support_handoff",
    non_db: "non_db",
  };

  if (aliases[normalizedIntent]) {
    return aliases[normalizedIntent];
  }
  if (normalizedMode === "recommend") {
    return "recommend_products";
  }
  if (normalizedMode === "non_db") {
    return "non_db";
  }
  return null;
}

function extractPlannerEntities(parsed = {}) {
  const candidates = [
    parsed?.entities,
    parsed?.products,
    parsed?.product_names,
    parsed?.terms,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    const normalized = [...new Set(
      candidate
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    )];
    if (normalized.length) return normalized;
  }

  if (typeof parsed?.entity === "string" && parsed.entity.trim()) {
    return [parsed.entity.trim()];
  }

  return [];
}

function buildPlanPayload(parsed = {}, forcedResource = null) {
  return {
    resource: forcedResource || parsed?.resource,
    joins: Array.isArray(parsed?.joins) ? parsed.joins : [],
    select: Array.isArray(parsed?.select) ? parsed.select : [],
    where: Array.isArray(parsed?.where) ? parsed.where : [],
    sort: Array.isArray(parsed?.sort) ? parsed.sort : [],
    limit: parsed?.limit,
  };
}

function inferIntentFromPlan(parsed = {}, entities = []) {
  if (entities.length >= 2) {
    return "compare_products";
  }

  if (extractOrderNumber(entities, parsed?.entity)) {
    return "order_lookup";
  }

  const resource = String(parsed?.resource || "").trim();
  if (!resource) {
    return null;
  }

  if (resource === "ProductVariant") {
    return "variant_search";
  }
  if (resource === "FlashSaleItem" || resource === "FlashSale") {
    return "flash_sale_lookup";
  }
  if (resource === "Order") {
    return "order_lookup";
  }
  if (resource === "Coupon") {
    return "coupon_lookup";
  }
  if (resource === "Article") {
    return "article_lookup";
  }
  if (resource !== "Product") {
    return null;
  }

  const select = Array.isArray(parsed?.select) ? parsed.select : [];
  const hasDetailFields = ["description", "origin_price", "spec_summary"].some(
    (field) => select.includes(field),
  );
  if (Number(parsed?.limit) === 1 || hasDetailFields) {
    return "product_detail";
  }

  return "product_search";
}

function normalizePlannerResult(parsed = {}, shopName) {
  const entities = extractPlannerEntities(parsed);
  const normalizedIntent =
    normalizeIntent(parsed?.intent, parsed?.mode) ||
    inferIntentFromPlan(parsed, entities);

  if (!normalizedIntent || !SUPPORTED_INTENTS.has(normalizedIntent)) {
    return {
      intent: "non_db",
      message: parsed?.message?.trim() || MESSAGES.DEFAULT_HINT(shopName),
    };
  }

  if (normalizedIntent === "non_db") {
    return {
      intent: "non_db",
      message: parsed?.message?.trim() || MESSAGES.DEFAULT_HINT(shopName),
    };
  }

  if (normalizedIntent === "recommend_products") {
    return { intent: "recommend_products", entities };
  }

  if (normalizedIntent === "support_handoff") {
    return {
      intent: "support_handoff",
      entities,
      message: parsed?.message?.trim() || null,
    };
  }

  return {
    intent: normalizedIntent,
    entities,
    plan: buildPlanPayload(parsed, INTENT_RESOURCE_MAP[normalizedIntent]),
  };
}

async function generateIntentPlan(question, history, runtime) {
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

  return normalizePlannerResult(parsed, getShopName(cfg));
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
      intent: "non_db",
      message: MESSAGES.GREETING(shopName),
      skipLlm: true,
    };
  }

  return null;
}

function logChatbotQuery({ prompt, modelName, provider, historyCount }) {
  console.log(
    "[CHATBOT QUERY]",
    JSON.stringify({
      prompt,
      modelName,
      provider,
      historyCount,
    }),
  );
}

function isMissingReadModelError(error) {
  return (
    error?.code === "42P01" &&
    /v_chatbot_(products|product_variants|flash_sale_items|user_purchase_events|orders)/.test(
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

function normalizeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    return ["true", "t", "1", "yes"].includes(value.trim().toLowerCase());
  }
  return false;
}

function formatOrderStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ORDER_STATUS_LABELS[normalized] || normalized || "không rõ";
}

function formatPaymentStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return PAYMENT_STATUS_LABELS[normalized] || normalized || "không rõ";
}

function formatDiscountLabel(row) {
  const discountType = String(row?.discount_type || "").trim().toUpperCase();
  const discountValue = toNumber(row?.discount_value);

  if (discountType === "PERCENTAGE" && discountValue !== null) {
    return `Giảm ${discountValue}%`;
  }
  if (discountType === "FIXED_AMOUNT" && discountValue !== null) {
    return `Giảm ${formatCurrency(discountValue)}`;
  }
  if (discountType === "FREE_SHIP") {
    const maxDiscountAmount = formatCurrency(row?.max_discount_amount);
    return maxDiscountAmount
      ? `Miễn phí vận chuyển, tối đa ${maxDiscountAmount}`
      : "Miễn phí vận chuyển";
  }

  return "Ưu đãi đặc biệt";
}

function formatCouponLine(row, index) {
  const code = row?.code || `VOUCHER-${index + 1}`;
  const parts = [`${index + 1}. **${code}** - ${formatDiscountLabel(row)}`];
  const minOrder = formatCurrency(row?.min_order_value);
  const maxDiscount = formatCurrency(row?.max_discount_amount);
  const endDate = formatDateTime(row?.end_date);

  if (minOrder) parts.push(`đơn tối thiểu ${minOrder}`);
  if (maxDiscount) parts.push(`giảm tối đa ${maxDiscount}`);
  if (endDate) parts.push(`hết hạn ${endDate}`);

  return parts.join(" - ");
}

function formatFlashSaleLine(row, index) {
  const productName =
    pickFirst(row, ["product_name", "display_name"]) ||
    `${MESSAGES.PRODUCT_FALLBACK_NAME} ${index + 1}`;
  const variantName = pickFirst(row, ["display_name"]);
  const detailParts = [];

  if (variantName && variantName !== productName) detailParts.push(variantName);
  if (row?.attribute_summary && !detailParts.includes(row.attribute_summary)) {
    detailParts.push(row.attribute_summary);
  }

  const flashPrice = formatCurrency(row?.flash_price);
  const stock = pickFirst(row, ["flash_stock"]);
  const soldCount = pickFirst(row, ["sold_count"]);
  const endDate = formatDateTime(row?.end_time);
  const saleName = row?.sale_name || null;

  const parts = [`${index + 1}. **${productName}**`];
  if (detailParts.length) parts.push(`- ${detailParts.join(" | ")}`);
  if (flashPrice) parts.push(`- ${flashPrice}`);
  if (stock !== null) parts.push(`(còn: ${stock})`);
  if (soldCount !== null && Number(soldCount) > 0) parts.push(`- đã bán: ${soldCount}`);
  if (saleName) parts.push(`- ${saleName}`);
  if (endDate) parts.push(`- hết lúc: ${endDate}`);

  return parts.join(" ");
}

function formatOrderLine(row, index) {
  const orderNumber = row?.order_number || `Đơn ${index + 1}`;
  const createdAt = formatDateTime(row?.created_at);
  const totalAmount = formatCurrency(row?.total_amount);
  const itemCount = toNumber(row?.item_count);
  const itemSummary = stripHtml(row?.item_summary || "");
  const trackingCode = row?.tracking_code || null;

  const lines = [
    `${index + 1}. **${orderNumber}** - ${formatOrderStatus(row?.order_status)} - ${formatPaymentStatus(row?.payment_status)}${totalAmount ? ` - ${totalAmount}` : ""}`,
  ];

  if (createdAt) lines.push(`   Đặt lúc: ${createdAt}`);
  if (itemCount !== null && itemCount > 0) {
    lines.push(`   Số dòng sản phẩm: ${itemCount}`);
  }
  if (itemSummary) lines.push(`   Sản phẩm: ${itemSummary}`);
  if (trackingCode) lines.push(`   Mã vận đơn: ${trackingCode}`);

  return lines.join("\n");
}

function isCouponCurrentlyAvailable(row, now = new Date()) {
  if (!normalizeBoolean(row?.is_public)) return false;
  if (String(row?.status || "").trim().toUpperCase() !== "ACTIVE") return false;

  const startDate = row?.start_date ? new Date(row.start_date) : null;
  const endDate = row?.end_date ? new Date(row.end_date) : null;

  if (startDate && !Number.isNaN(startDate.getTime()) && startDate > now) {
    return false;
  }
  if (endDate && !Number.isNaN(endDate.getTime()) && endDate < now) {
    return false;
  }

  const usageLimit = toNumber(row?.usage_limit);
  const usedCount = toNumber(row?.used_count) ?? 0;
  if (usageLimit !== null && usedCount >= usageLimit) {
    return false;
  }

  return true;
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
    if (resource === "Coupon") {
      return MESSAGES.NO_PUBLIC_VOUCHER;
    }
    if (resource === "FlashSaleItem") {
      return MESSAGES.NO_FLASH_SALE;
    }
    if (resource === "Order") {
      return MESSAGES.ORDER_NOT_FOUND;
    }
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
  } else if (resource === "Coupon") {
    lines = sliced.map((row, index) => formatCouponLine(row, index));
  } else if (resource === "FlashSaleItem") {
    lines = sliced.map((row, index) => formatFlashSaleLine(row, index));
  } else if (resource === "Order") {
    lines = sliced.map((row, index) => formatOrderLine(row, index));
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

function uniqueTerms(terms = []) {
  return [...new Set(
    (Array.isArray(terms) ? terms : [])
      .map((term) => String(term || "").trim())
      .filter(Boolean),
  )];
}

function extractWhereValues(plan, allowedFields = []) {
  if (!Array.isArray(plan?.where) || !allowedFields.length) {
    return [];
  }

  return uniqueTerms(
    plan.where
      .filter((clause) => allowedFields.includes(clause?.field))
      .flatMap((clause) => {
        if (Array.isArray(clause?.value)) return clause.value;
        return [clause?.value];
      })
      .filter((value) => typeof value === "string"),
  );
}

async function findFirstMatchingProduct(terms, queryTimeoutMs = 6000) {
  const uniqueLookupTerms = uniqueTerms(terms);
  for (const term of uniqueLookupTerms) {
    const product = await findBestMatchingProduct(term, queryTimeoutMs);
    if (product) {
      return product;
    }
  }
  return null;
}

async function resolveProductDetailProduct(planResult, queryTimeoutMs = 6000) {
  const detailTerms = uniqueTerms([
    ...(planResult?.entities || []),
    ...extractWhereValues(planResult?.plan, ["name"]),
  ]);

  return findFirstMatchingProduct(detailTerms, queryTimeoutMs);
}

function getComparisonTerms(planResult, userPrompt) {
  const plannerTerms = uniqueTerms(planResult?.entities || []);
  if (plannerTerms.length >= 2) {
    return plannerTerms.slice(0, 2);
  }

  const fallbackTerms = extractComparisonTerms(userPrompt);
  return uniqueTerms(fallbackTerms).slice(0, 2);
}

function getResponseMode(intent) {
  return intent === "recommend_products" ? "recommend" : intent === "non_db" ? "non_db" : "db";
}

function hasWhereField(plan, fields = []) {
  if (!Array.isArray(plan?.where) || !fields.length) {
    return false;
  }

  return plan.where.some((clause) => fields.includes(clause?.field));
}

function ensureJoin(plan, resource) {
  const joins = Array.isArray(plan?.joins) ? plan.joins : [];
  if (joins.some((join) => join?.resource === resource)) {
    return joins;
  }
  return [...joins, { resource }];
}

function extractCategoryHint(entities = []) {
  for (const term of uniqueTerms(entities)) {
    const normalizedTerm = normalizeLooseText(term);
    if (!normalizedTerm) continue;
    const matchedHint = CATEGORY_HINTS.find(
      (hint) =>
        normalizedTerm.includes(hint.match) ||
        hint.match.includes(normalizedTerm),
    );
    if (matchedHint) {
      return matchedHint.value;
    }
  }

  return null;
}

function dedupeSelect(fields = []) {
  return [...new Set((Array.isArray(fields) ? fields : []).filter(Boolean))];
}

function ensureSelectFields(plan, requiredFields = []) {
  return {
    ...plan,
    select: dedupeSelect([
      ...(Array.isArray(plan?.select) ? plan.select : []),
      ...requiredFields,
    ]),
  };
}

function ensureWhereClauses(plan, clauses = []) {
  const current = Array.isArray(plan?.where) ? plan.where : [];
  const seen = new Set(
    current.map((clause) =>
      JSON.stringify([clause?.field, clause?.op || "eq", clause?.value]),
    ),
  );
  const next = [...current];

  for (const clause of clauses) {
    if (!clause?.field) continue;
    const signature = JSON.stringify([
      clause.field,
      clause.op || "eq",
      clause.value,
    ]);
    if (seen.has(signature)) continue;
    seen.add(signature);
    next.push(clause);
  }

  return {
    ...plan,
    where: next,
  };
}

function pickAllowedWhereClauses(plan, allowedFields = []) {
  return (Array.isArray(plan?.where) ? plan.where : []).filter((clause) =>
    allowedFields.includes(clause?.field),
  );
}

function ensureSort(plan, fallbackSort = []) {
  const current = Array.isArray(plan?.sort) ? plan.sort.filter(Boolean) : [];
  return {
    ...plan,
    sort: current.length ? current : fallbackSort,
  };
}

function getUserScopeClause(authPrincipal) {
  return looksLikeUuid(authPrincipal)
    ? { field: "user_id", op: "eq", value: authPrincipal }
    : { field: "user_email", op: "eq", value: authPrincipal };
}

function buildOrderLookupPlan(plan, entities, userPrompt, authPrincipal, maxProducts) {
  const orderNumber = extractOrderNumber(
    entities,
    extractWhereValues(plan, ["order_number"]),
    userPrompt,
  );
  const basePlan = {
    resource: "Order",
    joins: [],
    select: [
      "order_number",
      "created_at",
      "order_status",
      "payment_status",
      "tracking_code",
      "total_amount",
      "item_count",
      "item_summary",
    ],
    where: [getUserScopeClause(authPrincipal)],
    sort: [{ field: "created_at", dir: "desc" }],
    limit: orderNumber ? 1 : Math.min(Math.max(maxProducts, 3), 10),
  };

  if (orderNumber) {
    basePlan.where.push({
      field: "order_number",
      op: "eq",
      value: orderNumber,
    });
    return basePlan;
  }

  const safePlannerFilters = pickAllowedWhereClauses(plan, [
    "order_status",
    "payment_status",
  ]);
  return ensureWhereClauses(basePlan, safePlannerFilters);
}

function applyVariantSearchGuard(plan, entities = []) {
  const categoryHint = extractCategoryHint(entities);
  if (!categoryHint) {
    return plan;
  }
  if (hasWhereField(plan, ["Product.category_name", "Product.name"])) {
    return plan;
  }

  return {
    ...plan,
    joins: ensureJoin(plan, "Product"),
    where: [
      { field: "Product.category_name", op: "contains", value: categoryHint },
      ...(Array.isArray(plan?.where) ? plan.where : []),
    ],
  };
}

function applyFlashSaleGuard(plan) {
  const nowIso = new Date().toISOString();
  return ensureSort(
    ensureWhereClauses(
      ensureSelectFields(plan, [
        "sale_name",
        "product_name",
        "display_name",
        "attribute_summary",
        "flash_price",
        "flash_stock",
        "sold_count",
        "end_time",
      ]),
      [
        { field: "sale_status", op: "eq", value: "ACTIVE" },
        { field: "start_time", op: "lte", value: nowIso },
        { field: "end_time", op: "gte", value: nowIso },
      ],
    ),
    [{ field: "end_time", dir: "asc" }],
  );
}

function applyCouponGuard(plan) {
  return ensureSort(
    ensureWhereClauses(
      ensureSelectFields(plan, [
        "code",
        "discount_type",
        "discount_value",
        "min_order_value",
        "max_discount_amount",
        "usage_limit",
        "used_count",
        "start_date",
        "end_date",
        "status",
        "is_public",
      ]),
      [
        { field: "status", op: "eq", value: "ACTIVE" },
        { field: "is_public", op: "eq", value: true },
      ],
    ),
    [{ field: "end_date", dir: "asc" }],
  );
}

function applyIntentGuards(intent, plan, entities, userPrompt, authPrincipal, runtime) {
  if (intent === "variant_search") {
    return applyVariantSearchGuard(plan, entities);
  }

  if (intent === "flash_sale_lookup") {
    return {
      ...applyFlashSaleGuard(plan),
      resource: "FlashSaleItem",
      limit: Math.min(Number(plan?.limit) || runtime.maxProducts, 10),
    };
  }

  if (intent === "coupon_lookup") {
    const desiredLimit = Math.min(
      Math.max(Number(plan?.limit) || runtime.maxProducts * 3, runtime.maxProducts * 3, 10),
      30,
    );
    return {
      ...applyCouponGuard(plan),
      resource: "Coupon",
      limit: desiredLimit,
    };
  }

  if (intent === "order_lookup") {
    return buildOrderLookupPlan(
      plan,
      entities,
      userPrompt,
      authPrincipal,
      runtime.maxProducts,
    );
  }

  return plan;
}

function postProcessRows(resource, rows, maxProducts) {
  if (resource === "Coupon") {
    return rows.filter((row) => isCouponCurrentlyAvailable(row)).slice(0, maxProducts);
  }

  return rows;
}

function getExecutionLimitCap(intent, runtime) {
  if (intent === "coupon_lookup") {
    return 30;
  }
  return runtime.maxProducts;
}

async function executeDbPlan(plan, runtime, options = {}) {
  const limitCap = options.limitCap ?? runtime.maxProducts;
  const executablePlan = {
    ...plan,
    limit:
      plan?.limit === undefined || plan.limit > limitCap
        ? limitCap
        : plan.limit,
  };

  const validPlan = validatePlan(executablePlan);
  const { sql, params } = planToSQL(validPlan);
  console.log("[SQL]", sql, params);

  const result = await runReadOnly(sql, params, runtime.dbTimeoutMs);
  console.log(`[DB RESULT] rowCount=${result.rowCount}`);

  return { validPlan, sql, params, result };
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

function isResponseSynthesisEnabled(appConfig, intent) {
  return (
    appConfig?.ai?.enableResponseSynthesis === true &&
    RESPONSE_SYNTHESIS_INTENTS.has(intent)
  );
}

function summarizeProductForContext(row, options = {}) {
  const includeDescription = options.includeDescription === true;
  const includeSpecs = options.includeSpecs === true;
  const description = stripHtml(row?.description || "");
  const summary = {
    name: pickFirst(row, ["name", "product_name", "title"]) || MESSAGES.PRODUCT_FALLBACK_NAME,
    brand_name: pickFirst(row, ["brand_name", "Brand_name"]) || null,
    category_name: pickFirst(row, ["category_name", "Category_name"]) || null,
    min_price: formatCurrency(pickFirst(row, ["min_price", "price", "origin_price"])),
    origin_price: formatCurrency(row?.origin_price),
    total_stock: pickFirst(row, ["total_stock", "stock_quantity"]),
    rating_summary: formatRatingSummary(row),
  };

  if (includeDescription && description) {
    summary.description = description.length > 420
      ? `${description.slice(0, 420).trimEnd()}...`
      : description;
  }

  if (includeSpecs) {
    summary.spec_highlights = getSpecHighlights(row?.spec_summary, 6);
  }

  return summary;
}

function summarizeArticleForContext(row) {
  return {
    title: row?.title || null,
    slug: row?.slug || null,
    created_at: formatDateTime(row?.created_at),
  };
}

function summarizeFlashSaleForContext(row) {
  return {
    product_name: pickFirst(row, ["product_name", "display_name"]) || MESSAGES.PRODUCT_FALLBACK_NAME,
    display_name: row?.display_name || null,
    attribute_summary: row?.attribute_summary || null,
    flash_price: formatCurrency(row?.flash_price),
    flash_stock: row?.flash_stock ?? null,
    end_time: formatDateTime(row?.end_time),
  };
}

function buildRecommendationSectionsForContext(recommendations, maxProducts = 3) {
  const sections = [];
  const labels = recommendations?._labels || {};

  const pushProductSection = (key, fallbackLabel) => {
    if (!recommendations?.[key]?.length) return;
    sections.push({
      label: labels[key] || fallbackLabel,
      items: recommendations[key]
        .slice(0, maxProducts)
        .map((row) => summarizeProductForContext(row)),
    });
  };

  pushProductSection("sameCategory", "Dựa trên danh mục bạn đã mua");
  pushProductSection("sameBrand", "Thương hiệu bạn yêu thích");
  pushProductSection("coPurchase", "Khách hàng cũng thường mua");
  pushProductSection("budgetMatch", "Phù hợp ngân sách của bạn");
  pushProductSection("featured", MESSAGES.SECTION_FEATURED);
  pushProductSection("topRated", MESSAGES.SECTION_TOP_RATED);

  if (recommendations?.flashSales?.length) {
    sections.push({
      label: MESSAGES.SECTION_FLASH_SALE,
      items: recommendations.flashSales
        .slice(0, maxProducts)
        .map((row) => summarizeFlashSaleForContext(row)),
    });
  }

  return sections;
}

function buildSafeContext(intent, payload = {}) {
  if (intent === "product_detail" && payload.product) {
    return {
      type: "product_detail",
      product: summarizeProductForContext(payload.product, {
        includeDescription: true,
        includeSpecs: true,
      }),
    };
  }

  if (intent === "product_search" && payload.rows?.length) {
    return {
      type: "product_search",
      result_count: payload.rows.length,
      products: payload.rows.map((row) => summarizeProductForContext(row)),
    };
  }

  if (
    intent === "compare_products" &&
    payload.leftProduct &&
    payload.rightProduct
  ) {
    const leftNotes = buildRelativeNotes(payload.leftProduct, payload.rightProduct);
    const rightNotes = buildRelativeNotes(payload.rightProduct, payload.leftProduct);

    return {
      type: "compare_products",
      products: [
        summarizeProductForContext(payload.leftProduct, { includeSpecs: true }),
        summarizeProductForContext(payload.rightProduct, { includeSpecs: true }),
      ],
      relative_notes: {
        left_advantages: leftNotes.advantages,
        left_considerations: leftNotes.considerations,
        right_advantages: rightNotes.advantages,
        right_considerations: rightNotes.considerations,
      },
    };
  }

  if (intent === "recommend_products" && payload.recommendations) {
    return {
      type: "recommend_products",
      personalized: payload.recommendations?._personalized === true,
      sections: buildRecommendationSectionsForContext(
        payload.recommendations,
        payload.maxProducts,
      ),
    };
  }

  if (intent === "article_lookup" && payload.rows?.length) {
    return {
      type: "article_lookup",
      result_count: payload.rows.length,
      articles: payload.rows.map((row) => summarizeArticleForContext(row)),
    };
  }

  return null;
}

function buildSynthesisInput(question, draftAnswer, safeContext) {
  return [
    `QUESTION: ${question}`,
    "",
    "TRUSTED_DRAFT_ANSWER:",
    draftAnswer,
    "",
    "SAFE_CONTEXT:",
    JSON.stringify(safeContext, null, 2),
    "",
    "Hãy viết lại câu trả lời cho tự nhiên hơn, bám sát dữ liệu và không thêm fact mới.",
  ].join("\n");
}

async function maybeSynthesizeAnswer({
  appConfig,
  runtime,
  intent,
  question,
  draftAnswer,
  safeContext,
}) {
  if (!isResponseSynthesisEnabled(appConfig, intent) || !draftAnswer || !safeContext) {
    return { answer: draftAnswer, used: false };
  }

  try {
    const synthesized = await callAI(
      MESSAGES.SYNTHESIS_SYSTEM(getShopName(appConfig), intent),
      [],
      buildSynthesisInput(question, draftAnswer, safeContext),
      false,
      {
        modelName: runtime.modelName,
        provider: runtime.provider,
        temperature: runtime.temperature,
        maxRetries: appConfig.ai?.maxRetries ?? 1,
        timeoutMs: appConfig.ai?.planTimeoutMs || 20000,
      },
    );

    const cleaned = String(synthesized || "").trim();
    if (!cleaned) {
      return { answer: draftAnswer, used: false };
    }

    return { answer: cleaned, used: true };
  } catch (error) {
    console.warn(`[SYNTHESIS] ${intent} fallback:`, error.message);
    return { answer: draftAnswer, used: false };
  }
}

function getSupportHandoffAnswer(authPrincipal) {
  return authPrincipal
    ? MESSAGES.SUPPORT_HANDOFF_AUTH
    : MESSAGES.SUPPORT_HANDOFF_GUEST;
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

    logChatbotQuery({
      prompt: userPrompt,
      modelName,
      provider: runtime.provider,
      historyCount: rawHistory.length,
    });

    const plannerHistory = trimChatHistory(rawHistory, HISTORY_BUDGETS.planner);
    const replyHistory = trimChatHistory(rawHistory, HISTORY_BUDGETS.reply);
    const shortcut = buildShortcutResult(userPrompt, getShopName(appConfig));
    const planResult =
      shortcut || (await generateIntentPlan(userPrompt, plannerHistory, runtime));
    const { intent, plan, message, skipLlm } = planResult;
    const responseMode = getResponseMode(intent);
    const authPrincipal = req.userId || null;

    if (intent === "compare_products") {
      const terms = getComparisonTerms(planResult, userPrompt);
      const { products, missingTerms } = await resolveComparisonProducts(
        terms,
        runtime.dbTimeoutMs,
      );
      const draftAnswer =
        products.length === 2
          ? buildComparisonAnswer(products[0], products[1])
          : buildComparisonFallbackAnswer(terms || [], products, missingTerms);
      const synthesis =
        products.length === 2
          ? await maybeSynthesizeAnswer({
            appConfig,
            runtime,
            intent,
            question: userPrompt,
            draftAnswer,
            safeContext: buildSafeContext(intent, {
              leftProduct: products[0],
              rightProduct: products[1],
            }),
          })
          : { answer: draftAnswer, used: false };

      return res.status(200).json({
        answer: synthesis.answer,
        mode: responseMode,
        resultCount: products.length,
        data: products,
      });
    }

    if (intent === "recommend_products") {
      const userId = req.userId || null;
      const recommendations = userId
        ? await getPersonalizedRecommendations(userId)
        : await getRecommendations();
      const draftAnswer = buildRecommendationAnswer(
        recommendations,
        runtime.maxProducts,
      );
      const synthesis = await maybeSynthesizeAnswer({
        appConfig,
        runtime,
        intent,
        question: userPrompt,
        draftAnswer,
        safeContext: buildSafeContext(intent, {
          recommendations,
          maxProducts: runtime.maxProducts,
        }),
      });

      return res.status(200).json({
        answer: synthesis.answer,
        mode: responseMode,
        data: recommendations,
      });
    }

    if (intent === "product_detail") {
      const product = await resolveProductDetailProduct(
        planResult,
        runtime.dbTimeoutMs,
      );
      const draftAnswer = product
        ? formatProductDetail(product)
        : MESSAGES.NO_DATA(userPrompt);
      const synthesis = product
        ? await maybeSynthesizeAnswer({
          appConfig,
          runtime,
          intent,
          question: userPrompt,
          draftAnswer,
          safeContext: buildSafeContext(intent, { product }),
        })
        : { answer: draftAnswer, used: false };

      return res.status(200).json({
        answer: synthesis.answer,
        mode: responseMode,
        resultCount: product ? 1 : 0,
        data: product ? [product] : [],
      });
    }

    if (intent === "support_handoff") {
      return res.status(200).json({
        answer: getSupportHandoffAnswer(authPrincipal),
        mode: "non_db",
      });
    }

    if (intent === "order_lookup" && !authPrincipal) {
      return res.status(200).json({
        answer: MESSAGES.ORDER_LOGIN_REQUIRED,
        mode: "non_db",
      });
    }

    if (intent === "non_db") {
      if (skipLlm) {
        return res.status(200).json({
          answer: message || MESSAGES.DEFAULT_HINT(getShopName(appConfig)),
          mode: responseMode,
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
          mode: responseMode,
        });
      } catch (error) {
        console.warn("[NON_DB] AI fallback:", error.message);
        return res.status(200).json({
          answer: message || MESSAGES.DEFAULT_HINT(getShopName(appConfig)),
          mode: responseMode,
        });
      }
    }

    if (!plan?.resource) {
      throw new Error("PLAN_RESOURCE_MISSING");
    }
    const enrichedPlan = applyIntentGuards(
      intent,
      plan,
      planResult.entities || [],
      userPrompt,
      authPrincipal,
      runtime,
    );
    console.log(
      "[PLAN]",
      JSON.stringify({
        intent,
        plan: enrichedPlan,
        entities: planResult.entities || [],
        authPrincipal,
      }),
    );

    const { validPlan, sql, params, result } = await executeDbPlan(
      enrichedPlan,
      runtime,
      { limitCap: getExecutionLimitCap(intent, runtime) },
    );
    const processedRows = postProcessRows(
      validPlan.resource,
      result.rows,
      runtime.maxProducts,
    );

    const draftAnswer = buildDbAnswer(
      userPrompt,
      validPlan.resource,
      processedRows,
      runtime.maxProducts,
    );
    const synthesis = await maybeSynthesizeAnswer({
      appConfig,
      runtime,
      intent,
      question: userPrompt,
      draftAnswer,
      safeContext: buildSafeContext(intent, {
        rows: processedRows,
      }),
    });

    const safeResponse = {
      answer: synthesis.answer,
      mode: responseMode,
      resultCount: processedRows.length,
    };

    if (DEBUG_RESPONSE) {
      safeResponse.debug = {
        plan: validPlan,
        sql,
        params,
        rowCount: result.rowCount,
        filteredRowCount: processedRows.length,
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
      error?.message === "SELECT_EMPTY" ||
      error?.message === "PLAN_RESOURCE_MISSING"
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
