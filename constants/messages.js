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
    `Bạn muốn tìm hiểu về sản phẩm, khuyến mãi, hay cần tư vấn gì ạ?`,

  /*  DB mode  */
  NO_DATA: (query) =>
    `Mình chưa có dữ liệu phù hợp cho "${query}". Bạn thử đổi từ khóa hoặc khoảng giá cụ thể hơn nhé.`,
  RESULT_HEADER: (count, query) =>
    `Mình tìm thấy ${count} kết quả cho "${query}":`,

  /*  Recommend mode  */
  RECOMMEND_HEADER: "Mình gợi ý cho bạn:",
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

  /* n system instruction  */
  PLAN_SYSTEM: (shopName, schemaText, fewShot, allowed) =>
    `Bạn là trợ lý lập kế hoạch truy vấn DB của cửa hàng ${shopName}.
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
- Khi user hỏi CHI TIẾT / CỤ THỂ về 1 sản phẩm (VD: "chi tiết iPhone 17", "thông tin Laptop Lenovo"):
  • select phải bao gồm: name, description, specs_json, origin_price
  • joins phải có: Category, Brand, MinVariant, FeedbackStat
  • select thêm: Category.name, Brand.name, MinVariant.min_price, MinVariant.total_stock, FeedbackStat.avg_rating, FeedbackStat.review_count
  • limit: 1
- Ý định mua/bán/sản phẩm/giá → coi là truy vấn Product (không hỏi lại).
- Nếu câu hỏi là YÊU CẦU GỢI Ý / TƯ VẤN CHUNG (VD: "gợi ý cho mình", "tư vấn giùm", "có gì hay"), trả {"mode":"recommend","intent":"general"}.
- Nếu thực sự KHÔNG phù hợp truy vấn DB (chit-chat thuần), trả {"message":"<gợi ý lịch sự>"}.
- Không sinh SQL. Không bịa tên bảng/field.

${schemaText}

${fewShot}`,
};
