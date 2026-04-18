/**
 * Tập trung tất cả chuỗi hardcode của chatbot.
 * Khi cần đổi ngôn ngữ / branding chỉ sửa file này.
 */

export const MESSAGES = {
  /*  Chatbot disabled  */
  DISABLED:
    "Chatbot hiện đang tạm ngưng hoạt động. Vui lòng liên hệ hotline để được hỗ trợ.",

  /*  Prompt trống  */
  EMPTY_PROMPT: "empty_prompt",

  /*  Fallback mặc định  */
  DEFAULT_HINT: (shopName) =>
    `Bạn muốn tìm hiểu về sản phẩm, khuyến mãi, hay cần tư vấn gì tại ${shopName} ạ?`,
  GREETING: (shopName) =>
    `Xin chào! Mình là trợ lý của ${shopName}. Mình có thể giúp tìm sản phẩm, xem khuyến mãi, hoặc gợi ý cấu hình phù hợp cho bạn.`,

  /*  DB mode  */
  NO_DATA: (query) =>
    `Mình chưa có dữ liệu phù hợp cho "${query}". Bạn thử đổi từ khóa hoặc khoảng giá cụ thể hơn nhé.`,
  RESULT_HEADER: (count, query) =>
    `Mình tìm thấy ${count} kết quả cho "${query}":`,

  /*  Recommend mode  */
  RECOMMEND_HEADER: "Mình gợi ý cho bạn:",
  RECOMMEND_PERSONAL_HEADER:
    "Dựa trên lịch sử mua hàng, mình gợi ý riêng cho bạn:",
  RECOMMEND_EMPTY:
    "Hiện tại chưa có dữ liệu gợi ý phù hợp. Bạn có thể hỏi theo danh mục hoặc mức giá cụ thể.",
  SECTION_FEATURED: "Sản phẩm nổi bật",
  SECTION_TOP_RATED: "Đánh giá cao",
  SECTION_FLASH_SALE: "Flash Sale đang diễn ra",
  PRODUCT_FALLBACK_NAME: "Sản phẩm",

  /*  Error messages  */
  ERR_UNCLEAR:
    "Câu hỏi chưa rõ. Bạn muốn tìm hiểu về sản phẩm, danh mục, khuyến mãi, hay đánh giá ạ?",
  ERR_AI_BUSY:
    "Hệ thống AI đang bận nên phản hồi chậm. Bạn vui lòng thử lại sau ít phút hoặc liên hệ hotline để được hỗ trợ nhanh.",
  ERR_DB_SYNCING:
    "Dữ liệu chatbot đang được đồng bộ lại sau khi cập nhật hệ thống. Bạn vui lòng thử lại sau ít phút.",

  /*  Planner system instruction  */
  PLAN_SYSTEM: (shopName, schemaText, fewShot, allowed) =>
    `Bạn là trợ lý lập kế hoạch truy vấn DB của cửa hàng ${shopName}.
- Ưu tiên truy vấn dữ liệu cửa hàng trước.
- Trả về JSON: {"resource":"<${allowed}>","joins":[],"select":[],"where":[],"sort":[],"limit":number}
- CHỈ được JOIN theo "relations" trong CONTRACT.
- Resource Product đã có sẵn các field: min_price, max_price, total_stock, avg_rating, review_count, brand_name, category_name, spec_summary.
- Nếu câu hỏi nhắc tên danh mục khi resource=Product, thêm joins:[{"resource":"Category"}] và lọc "Category.name".
- Nếu câu hỏi nhắc tên thương hiệu, thêm joins:[{"resource":"Brand"}] và lọc "Brand.name".
- "đánh giá tốt nhất" = sort avg_rating DESC rồi review_count DESC.
- Hỏi chi tiết / thông số 1 sản phẩm = resource Product, select trực tiếp name, description, origin_price, min_price, total_stock, brand_name, category_name, avg_rating, review_count, spec_summary, limit 1.
- Hỏi phiên bản / cấu hình / SKU của 1 sản phẩm = resource ProductVariant, JOIN Product, select Product.name, display_name, attribute_summary, price, compare_at_price, stock_quantity.
- Ý định mua/bán/sản phẩm/giá → coi là truy vấn Product (không hỏi lại).
- Yêu cầu gợi ý / tư vấn chung như "gợi ý cho mình", "tư vấn giùm", "có gì hay" → trả {"mode":"recommend","intent":"general"}.
- Chỉ khi thực sự không phải câu hỏi dữ liệu cửa hàng mới trả {"message":"<gợi ý lịch sự>"}.
- Không sinh SQL. Không bịa tên bảng/field.

${schemaText}

${fewShot}`,
};
