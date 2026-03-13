import OpenAI from "openai";
import promptSystem from "../prompt/prompt-system.js";
import { contractToPrompt } from "../prompt/contract-to-prompt.js";
import { fewShotExamples } from "../prompt/few-shot.js";
import { validatePlan } from "../prompt/plan-validate.js";
import { planToSQL } from "../prompt/plan-to-sql.js";
import { runReadOnly } from "../db/executor.js";
import { CONTRACT } from "../db/contract.js";
import { getRecommendations } from "../prompt/recommendation.js";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

/* ─── Chuyển đổi FE history → OpenAI messages ─── */
function formatHistory(history) {
  return history.map((m) => ({
    role: m.role === "bot" ? "assistant" : "user",
    content: m.content,
  }));
}

/* ─── Bước 1: Gọi OpenAI tạo kế hoạch truy vấn DB ─── */
async function generatePlan(question, history) {
  const schemaText = contractToPrompt();
  const allowed = Object.keys(CONTRACT.resources).join(", ");

  const resp = await openai.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `Bạn là trợ lý lập kế hoạch truy vấn DB của cửa hàng Hozitech.
- Luôn cố gắng lập kế hoạch truy vấn vào dữ liệu cửa hàng trước.
- Trả về JSON: {"resource":"<${allowed}>","joins":[],"select":[],"where":[],"sort":[],"limit":number}
- CHỈ được JOIN theo "relations" trong CONTRACT.
- Nếu câu hỏi nhắc tên DANH MỤC (vd "điện thoại", "laptop", "tivi") khi resource=Product:
  • phải thêm joins:[{"resource":"Category"}]
  • và lọc theo field "Category.name" (contains/ILIKE).
- Nếu nhắc tên THƯƠNG HIỆU (vd "apple", "samsung"):
  • phải thêm joins:[{"resource":"Brand"}]
  • và lọc theo "Brand.name" (contains/ILIKE).
- "đánh giá tốt nhất" = JOIN FeedbackStat, sort avg_rating DESC, tie-break review_count DESC.
- Muốn xem giá bán / tồn kho = JOIN MinVariant (min_price, total_stock).
- Ý định mua/bán/sản phẩm/giá → coi là truy vấn Product (không hỏi lại).
- Nếu câu hỏi là YÊU CẦU GỢI Ý / TƯ VẤN CHUNG (VD: "gợi ý cho mình", "tư vấn giùm", "có gì hay"), trả {"mode":"recommend","intent":"general"}.
- Nếu thực sự KHÔNG phù hợp truy vấn DB (chit-chat thuần), trả {"message":"<gợi ý lịch sự>"}.
- Không sinh SQL. Không bịa tên bảng/field.`,
      },
      { role: "system", content: schemaText },
      { role: "system", content: fewShotExamples },

      // Lịch sử chat
      ...formatHistory(history),

      // Câu hỏi hiện tại
      { role: "user", content: question },
    ],
  });

  let obj = {};
  try {
    obj = JSON.parse(resp.choices[0].message.content || "{}");
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
  const hint =
    obj?.message?.trim() ||
    "Bạn muốn tìm hiểu về sản phẩm, khuyến mãi, hay cần tư vấn gì ạ?";
  return { mode: "non_db", message: hint };
}

/* ─── Controller chính — 3 mode: db / non_db / recommend ─── */
export const chatbot = async (req, res) => {
  try {
    const userPrompt = (req.body.prompt || "").trim();
    const history = Array.isArray(req.body.history) ? req.body.history : [];

    if (!userPrompt) return res.status(400).json({ error: "empty_prompt" });

    const { mode, plan, message, intent } = await generatePlan(userPrompt, history);

    /* ═══════════ MODE: RECOMMEND (Gợi ý sản phẩm) ═══════════ */
    if (mode === "recommend") {
      const recommendations = await getRecommendations();

      const payload = {
        question: userPrompt,
        intent,
        featured: recommendations.featured,
        topRated: recommendations.topRated,
        flashSales: recommendations.flashSales,
      };

      const summary = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          {
            role: "system",
            content: `${promptSystem.system}
- Bạn đang ở CHẾ ĐỘ GỢI Ý SẢN PHẨM.
- Dùng data được cung cấp để gợi ý sản phẩm phù hợp cho khách.
- Chia thành các nhóm: Sản phẩm nổi bật, Được đánh giá cao, Flash Sale (nếu có).
- Trình bày dạng danh sách ngắn gọn, kèm giá bán.
- Nếu nhóm nào không có data, bỏ qua không nhắc.
- FORMAT giá: dùng dấu chấm phân cách hàng nghìn + "đ" (VD: 12.990.000đ).`,
          },
          ...formatHistory(history),
          { role: "user", content: JSON.stringify(payload) },
        ],
      });

      return res.status(200).json({
        answer: summary.choices[0].message.content,
        mode: "recommend",
        data: recommendations,
      });
    }

    /* ═══════════ MODE: NON_DB (Chit-chat) ═══════════ */
    if (mode === "non_db") {
      const ans = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: promptSystem.system },
          ...formatHistory(history),
          { role: "user", content: message || userPrompt },
        ],
      });

      return res.status(200).json({
        answer: ans.choices[0].message.content,
        mode,
      });
    }

    /* ═══════════ MODE: DB (Truy vấn dữ liệu) ═══════════ */
    console.log("[PLAN]", JSON.stringify(plan));

    const valid = validatePlan(plan);
    const { sql, params } = planToSQL(valid);
    console.log("[SQL]", sql, params);

    const result = await runReadOnly(sql, params, 6000);

    const payload = {
      question: userPrompt,
      plan: valid,
      sql,
      columns: result.columns,
      rows: result.rows,
    };

    const summary = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content: `${promptSystem.system}
- Chỉ dùng DATA được cung cấp; nếu không có data, báo "Chưa có dữ liệu phù hợp" và gợi ý liên hệ.
- FORMAT giá: dùng dấu chấm phân cách hàng nghìn + "đ" (VD: 12.990.000đ).
- Trình bày danh sách sản phẩm dạng gọn, dễ đọc.`,
        },
        ...formatHistory(history),
        { role: "user", content: JSON.stringify(payload) },
      ],
    });

    return res.status(200).json({
      answer: summary.choices[0].message.content,
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
        answer:
          "Câu hỏi chưa rõ. Bạn muốn tìm hiểu về sản phẩm, danh mục, khuyến mãi, hay đánh giá ạ?",
        mode: "non_db",
      });
    }
    return res.status(500).json({ error: e.message });
  }
};
