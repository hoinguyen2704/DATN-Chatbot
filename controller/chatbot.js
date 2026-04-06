import { GoogleGenerativeAI } from "@google/generative-ai";
import { contractToPrompt } from "../prompt/contract-to-prompt.js";
import { fewShotExamples } from "../prompt/few-shot.js";
import { validatePlan } from "../prompt/plan-validate.js";
import { planToSQL } from "../prompt/plan-to-sql.js";
import { runReadOnly } from "../db/executor.js";
import { CONTRACT } from "../db/contract.js";
import { getRecommendations } from "../prompt/recommendation.js";
import { getConfig } from "../config/config-manager.js";
import { MESSAGES } from "../constants/messages.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/*  Helper: lấy model name từ config (dynamic)  */
function getModelName(config) {
  return config?.ai?.model || process.env.GEMINI_MODEL || "gemini-2.0-flash";
}

/*  Helper: lấy shop name từ config  */
function getShopName(config) {
  return config?.shopInfo?.name || "Hozitech";
}

const FALLBACK_MODEL = "gemini-2.0-flash";

function withTimeout(promise, timeoutMs, errorMessage = "GEMINI_TIMEOUT") {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/*  Helper: chuyển FE history → Gemini history format */
function formatGeminiHistory(history) {
  return history.map((m) => ({
    role: m.role === "bot" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

/*  Helper: gọi Gemini với auto-retry + fallback model  */
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

  const genConfig = jsonMode
    ? { responseMimeType: "application/json", temperature }
    : { temperature };

  for (const modelName of modelsToTry) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const startedAt = Date.now();
        console.log(`[GEMINI START] model=${modelName} json=${jsonMode}`);
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction,
          generationConfig: genConfig,
        });
        const chat = model.startChat({ history: formatGeminiHistory(history) });
        const result = await withTimeout(
          chat.sendMessage(userMessage),
          timeoutMs,
        );
        console.log(
          `[GEMINI DONE] model=${modelName} ms=${Date.now() - startedAt}`,
        );
        return result.response.text();
      } catch (err) {
        lastError = err;
        const status = err?.status || err?.response?.status;
        const isTimeout = err?.message === "GEMINI_TIMEOUT";
        const isRetryable = status === 503 || status === 429 || isTimeout;

        if (isRetryable && attempt < maxRetries) {
          const delay = Math.min(attempt * 1000, 3000); // 1s, 2s, 3s
          console.log(
            `[GEMINI RETRY] ${modelName} attempt ${attempt}/${maxRetries} (${status || err?.message}), wait ${delay}ms...`,
          );
          await new Promise((r) => setTimeout(r, delay));
        } else if (isRetryable && modelName !== FALLBACK_MODEL) {
          console.log(
            `[GEMINI FALLBACK] ${modelName} unavailable, switching to ${FALLBACK_MODEL}`,
          );
          break; // break inner loop, try next model
        } else {
          throw err;
        }
      }
    }
  }

  throw lastError || new Error("GEMINI_UNAVAILABLE");
}

/*  Bước 1: Gọi Gemini tạo kế hoạch truy vấn DB  */
async function generatePlan(question, history, runtime) {
  const schemaText = contractToPrompt();
  const allowed = Object.keys(CONTRACT.resources).join(", ");
  const shopName = getShopName(getConfig());

  const cfg = getConfig();
  const systemInstruction = MESSAGES.PLAN_SYSTEM(
    shopName,
    schemaText,
    fewShotExamples,
    allowed,
  );

  const text = await callGemini(systemInstruction, history, question, true, {
    timeoutMs: cfg?.ai?.planTimeoutMs || 20000,
    maxRetries: cfg?.ai?.maxRetries ?? 1,
    modelName: runtime.modelName,
    temperature: runtime.temperature,
    modelsToTry: [runtime.modelName],
  });

  let obj = {};
  try {
    obj = JSON.parse(text || "{}");
  } catch {}

  // Recommend mode
  if (obj?.mode === "recommend") {
    return { mode: "recommend", intent: obj.intent || "general" };
  }

  // DB mode
  if (obj?.resource) {
    return { mode: "db", plan: obj };
  }

  // Non-DB (chit-chat)
  const hint = obj?.message?.trim() || MESSAGES.DEFAULT_HINT(shopName);
  return { mode: "non_db", message: hint };
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatCurrency(value) {
  const num = toNumber(value);
  if (num === null) return null;
  return `${Math.round(num).toLocaleString("vi-VN")}đ`;
}

function pickFirst(obj, keys) {
  for (const key of keys) {
    if (obj?.[key] !== undefined && obj?.[key] !== null && obj?.[key] !== "") {
      return obj[key];
    }
  }
  return null;
}

function formatProductLine(row, idx) {
  const name =
    pickFirst(row, ["name", "variant_name", "title"]) ||
    `${MESSAGES.PRODUCT_FALLBACK_NAME} ${idx + 1}`;
  const price = pickFirst(row, [
    "MinVariant_min_price",
    "min_price",
    "flash_price",
    "price",
    "origin_price",
  ]);
  const stock = pickFirst(row, [
    "MinVariant_total_stock",
    "total_stock",
    "flash_stock",
    "stock_quantity",
  ]);
  const category = pickFirst(row, ["Category_name", "category_name"]);
  const rating = pickFirst(row, ["FeedbackStat_avg_rating", "avg_rating"]);
  const reviewCount = pickFirst(row, [
    "FeedbackStat_review_count",
    "review_count",
  ]);

  const parts = [`${idx + 1}. **${name}**`];
  const formattedPrice = formatCurrency(price);
  if (formattedPrice) parts.push(`- ${formattedPrice}`);
  if (stock !== null) parts.push(`(tồn: ${stock})`);
  if (category) parts.push(`- ${category}`);
  if (rating !== null)
    parts.push(
      `- ⭐ ${rating}${reviewCount !== null ? ` (${reviewCount} đánh giá)` : ""}`,
    );

  return parts.join(" ");
}

function formatGenericLine(row, idx) {
  const keys = Object.keys(row || {}).slice(0, 4);
  const details = keys
    .map((k) => {
      const raw = row[k];
      if (raw === null || raw === undefined || raw === "") return null;
      const maybePrice = /price|amount|total/i.test(k)
        ? formatCurrency(raw)
        : null;
      return `${k}: ${maybePrice || raw}`;
    })
    .filter(Boolean)
    .join(" | ");
  return `${idx + 1}. ${details || "Không có dữ liệu hiển thị"}`;
}

/*  Strip HTML tags → plain text  */
function stripHtml(html) {
  if (!html || typeof html !== "string") return "";
  return html
    .replace(/<[^>]*>/g, "") // xoá tags
    .replace(/&nbsp;/gi, " ") // decode &nbsp;
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ") // gộp khoảng trắng
    .trim();
}

/*  Chi tiết 1 sản phẩm  */
function formatProductDetail(row) {
  const name =
    pickFirst(row, ["name", "variant_name", "title"]) ||
    MESSAGES.PRODUCT_FALLBACK_NAME;
  const price = pickFirst(row, [
    "MinVariant_min_price",
    "min_price",
    "flash_price",
    "price",
    "origin_price",
  ]);
  const originPrice = row.origin_price ?? null;
  const stock = pickFirst(row, [
    "MinVariant_total_stock",
    "total_stock",
    "stock_quantity",
  ]);
  const category = pickFirst(row, ["Category_name", "category_name"]);
  const brand = pickFirst(row, ["Brand_name", "brand_name"]);
  const rating = pickFirst(row, ["FeedbackStat_avg_rating", "avg_rating"]);
  const reviewCount = pickFirst(row, [
    "FeedbackStat_review_count",
    "review_count",
  ]);
  const rawDesc = row.description || null;
  const specs = row.specs_json || null;

  const lines = [`**${name}**\n`];

  if (brand) lines.push(`🏷️ Thương hiệu: **${brand}**`);
  if (category) lines.push(`📂 Danh mục: ${category}`);

  const formattedPrice = formatCurrency(price);
  const formattedOrigin = formatCurrency(originPrice);
  if (formattedPrice) {
    let priceLine = `💰 Giá: **${formattedPrice}**`;
    if (formattedOrigin && originPrice !== price)
      priceLine += ` ~~${formattedOrigin}~~`;
    lines.push(priceLine);
  }

  if (stock !== null) lines.push(`📦 Tồn kho: ${stock}`);
  if (rating !== null)
    lines.push(
      `⭐ Đánh giá: ${rating}/5${reviewCount ? ` (${reviewCount} lượt)` : ""}`,
    );

  if (rawDesc) {
    const clean = stripHtml(rawDesc);
    if (clean) {
      const short = clean.length > 200 ? clean.slice(0, 200) + "..." : clean;
      lines.push(`\n📝 **Mô tả:**\n\n${short}`);
    }
  }

  if (specs) {
    try {
      const parsed = typeof specs === "string" ? JSON.parse(specs) : specs;
      if (typeof parsed === "object" && parsed !== null) {
        const specLines = Object.entries(parsed)
          .slice(0, 8)
          .map(([k, v]) => `- **${k}:** ${stripHtml(String(v))}`);
        if (specLines.length)
          lines.push(`\n⚙️ **Thông số kỹ thuật:**\n\n${specLines.join("\n")}`);
      }
    } catch {}
  }

  return lines.join("\n");
}

function buildDbAnswer(userPrompt, rows, maxProducts = 3) {
  if (!rows?.length) {
    return MESSAGES.NO_DATA(userPrompt);
  }

  const looksLikeProduct = rows.some(
    (r) =>
      pickFirst(r, ["name", "variant_name"]) &&
      pickFirst(r, [
        "MinVariant_min_price",
        "min_price",
        "price",
        "flash_price",
        "origin_price",
      ]) !== null,
  );

  // Nếu chỉ 1 sản phẩm → hiển thị chi tiết
  if (looksLikeProduct && rows.length === 1) {
    return formatProductDetail(rows[0]);
  }

  const sliced = rows.slice(0, maxProducts);
  const lines = sliced.map((row, idx) =>
    looksLikeProduct
      ? formatProductLine(row, idx)
      : formatGenericLine(row, idx),
  );

  return `${MESSAGES.RESULT_HEADER(sliced.length, userPrompt)}\n${lines.join("\n")}`;
}

function formatDateTime(input) {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  return d.toLocaleString("vi-VN");
}

function buildRecommendationAnswer(recommendations, maxProducts = 3) {
  const sections = [];

  if (recommendations?.featured?.length) {
    const lines = recommendations.featured
      .slice(0, maxProducts)
      .map((r, i) => formatProductLine(r, i));
    sections.push(`**${MESSAGES.SECTION_FEATURED}**\n${lines.join("\n")}`);
  }

  if (recommendations?.topRated?.length) {
    const lines = recommendations.topRated
      .slice(0, maxProducts)
      .map((r, i) => formatProductLine(r, i));
    sections.push(`**${MESSAGES.SECTION_TOP_RATED}**\n${lines.join("\n")}`);
  }

  if (recommendations?.flashSales?.length) {
    const lines = recommendations.flashSales
      .slice(0, maxProducts)
      .map((r, i) => {
        const price = formatCurrency(r.flash_price);
        const end = formatDateTime(r.end_time);
        return `${i + 1}. **${r.variant_name || MESSAGES.PRODUCT_FALLBACK_NAME}**${price ? ` - ${price}` : ""}${r.flash_stock !== undefined ? ` (còn: ${r.flash_stock})` : ""}${end ? ` - hết hạn: ${end}` : ""}`;
      });
    sections.push(`**${MESSAGES.SECTION_FLASH_SALE}**\n${lines.join("\n")}`);
  }

  if (!sections.length) {
    return MESSAGES.RECOMMEND_EMPTY;
  }

  return `${MESSAGES.RECOMMEND_HEADER}\n\n${sections.join("\n\n")}`;
}

/*  Controller chính — 3 mode: db / non_db / recommend  */
export const chatbot = async (req, res) => {
  try {
    /* iểm tra chatbot có đang bật không  */
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

    const userPrompt = (req.body.prompt || "").trim();
    const history = Array.isArray(req.body.history) ? req.body.history : [];

    if (!userPrompt)
      return res.status(400).json({ error: MESSAGES.EMPTY_PROMPT });

    const { mode, plan, message } = await generatePlan(
      userPrompt,
      history,
      runtime,
    );

    /* ═══════════ MODE: RECOMMEND (Gợi ý sản phẩm) ═══════════ */
    if (mode === "recommend") {
      const recommendations = await getRecommendations();
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

    /* ═══════════ MODE: NON_DB (Chit-chat) ═══════════ */
    if (mode === "non_db") {
      return res.status(200).json({
        answer: message || MESSAGES.DEFAULT_HINT(getShopName(appConfig)),
        mode,
      });
    }

    /* ═══════════ MODE: DB (Truy vấn dữ liệu) ═══════════ */
    console.log("[PLAN]", JSON.stringify(plan));

    // Cap SQL limit bằng maxProducts config
    if (plan.limit === undefined || plan.limit > runtime.maxProducts) {
      plan.limit = runtime.maxProducts;
    }
    const valid = validatePlan(plan);
    const { sql, params } = planToSQL(valid);
    console.log("[SQL]", sql, params);

    const result = await runReadOnly(sql, params, runtime.dbTimeoutMs);
    console.log(`[DB RESULT] rowCount=${result.rowCount}`);

    const answer = buildDbAnswer(userPrompt, result.rows, runtime.maxProducts);

    return res.status(200).json({
      answer,
      mode,
      plan: valid,
      sql,
      params,
      rowCount: result.rowCount,
      rows: result.rows,
    });
  } catch (e) {
    console.error("[CHATBOT ERROR]", e);
    if (
      e?.message === "RESOURCE_NOT_ALLOWED" ||
      e?.message === "SELECT_EMPTY"
    ) {
      return res.status(200).json({
        answer: MESSAGES.ERR_UNCLEAR,
        mode: "non_db",
      });
    }
    if (
      e?.message === "GEMINI_TIMEOUT" ||
      e?.message === "GEMINI_UNAVAILABLE"
    ) {
      return res.status(200).json({
        answer: MESSAGES.ERR_AI_BUSY,
        mode: "non_db",
      });
    }
    return res.status(500).json({ error: e.message });
  }
};
