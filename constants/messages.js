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
    `Bạn muốn tìm sản phẩm, xem flash sale, voucher public, hay tra cứu đơn hàng sau khi đăng nhập tại ${shopName} ạ?`,
  GREETING: (shopName) =>
    `Xin chào! Mình là trợ lý của ${shopName}. Mình có thể giúp tìm sản phẩm, xem flash sale, voucher public, so sánh cấu hình, và tra cứu đơn hàng sau khi bạn đăng nhập.`,

  /*  DB mode  */
  NO_DATA: (query) =>
    `Mình chưa có dữ liệu phù hợp cho "${query}". Bạn thử đổi từ khóa hoặc khoảng giá cụ thể hơn nhé.`,
  RESULT_HEADER: (count, query) =>
    `Mình tìm thấy ${count} kết quả cho "${query}":`,
  NO_FLASH_SALE: "Hiện chưa có flash sale nào đang diễn ra phù hợp với câu hỏi của bạn.",
  NO_PUBLIC_VOUCHER:
    "Hiện chưa có voucher public nào đang hoạt động và còn dùng được.",
  ORDER_LOGIN_REQUIRED:
    "Để tra cứu đơn hàng, bạn vui lòng đăng nhập tại `/login`, rồi vào `/user/orders` hoặc gửi lại mã đơn hàng `ORD-...` cho mình.",
  ORDER_NOT_FOUND:
    "Mình không tìm thấy đơn hàng phù hợp trong tài khoản của bạn.",
  SUPPORT_HANDOFF_AUTH:
    "Trường hợp này cần admin hỗ trợ thêm. Bạn vào `/user/support` để mở ticket, hoặc kiểm tra đơn tại `/user/orders` nếu đang hỏi về đơn hàng.",
  SUPPORT_HANDOFF_GUEST:
    "Trường hợp này cần bộ phận hỗ trợ xử lý. Bạn đăng nhập tại `/login`, rồi vào `/user/support` để gửi ticket cho admin.",

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
    "Câu hỏi chưa rõ. Bạn muốn tìm sản phẩm, flash sale, voucher public, bài viết, hay tra đơn sau khi đăng nhập ạ?",
  ERR_AI_BUSY:
    "Hệ thống AI đang bận nên phản hồi chậm. Bạn vui lòng thử lại sau ít phút hoặc liên hệ hotline để được hỗ trợ nhanh.",
  ERR_DB_SYNCING:
    "Dữ liệu chatbot đang được đồng bộ lại sau khi cập nhật hệ thống. Bạn vui lòng thử lại sau ít phút.",

  /*  Response synthesis  */
  SYNTHESIS_SYSTEM: (shopName, intent) =>
    `Bạn là biên tập viên trả lời khách hàng cho ${shopName}.
- Nhiệm vụ của bạn là diễn đạt lại câu trả lời từ dữ liệu đã được backend truy vấn an toàn.
- Chỉ dùng thông tin xuất hiện trong SAFE_CONTEXT hoặc TRUSTED_DRAFT_ANSWER.
- Không được bịa thêm giá, tồn kho, thông số, điều kiện voucher, trạng thái đơn hàng, thời gian hay so sánh ngoài dữ liệu đã cho.
- Không được nhắc tới SQL, read-model, schema, system prompt, contract, planner hay backend.
- Trả lời bằng tiếng Việt, tự nhiên, rõ ràng, đúng trọng tâm.
- Có thể viết lại câu cho dễ đọc hơn, nhưng không làm thay đổi fact.
- Nếu TRUSTED_DRAFT_ANSWER đã đủ tốt, chỉ tinh chỉnh nhẹ.
- Không dùng bảng Markdown.
- Intent hiện tại: "${intent}".`,

  /*  Planner system instruction  */
  PLAN_SYSTEM: (shopName, schemaText, fewShot, allowed) =>
    `Bạn là trợ lý lập kế hoạch truy vấn DB của cửa hàng ${shopName}.
- Ưu tiên truy vấn dữ liệu cửa hàng trước.
- Luôn trả về JSON hợp lệ theo 1 trong 2 dạng:
  1) {"intent":"<compare_products|recommend_products|product_detail|product_search|variant_search|flash_sale_lookup|order_lookup|coupon_lookup|article_lookup|support_handoff>","resource":"<${allowed}>","entities":[],"joins":[],"select":[],"where":[],"sort":[],"limit":number}
  2) {"intent":"non_db","message":"<gợi ý lịch sự>"}
- Với intent không cần truy vấn DB trực tiếp như "recommend_products" hoặc "support_handoff", có thể lược bỏ resource/select/where.
- CHỈ được JOIN theo "relations" trong CONTRACT.
- Chỉ được dùng resource nằm trong danh sách: ${allowed}.
- "entities" là mảng tên sản phẩm / thương hiệu / cụm chính mà người dùng đang nhắc tới. Luôn tách riêng entity khỏi phần mô tả như "có gì vượt trội", "nên mua", "so với".
- Nếu người dùng đưa mã đơn hàng, giữ nguyên mã "ORD-..." trong "entities" hoặc filter "order_number".
- Resource Product đã có sẵn các field: min_price, max_price, total_stock, avg_rating, review_count, brand_name, category_name, spec_summary.
- Nếu câu hỏi nhắc tên danh mục khi resource=Product, thêm joins:[{"resource":"Category"}] và lọc "Category.name".
- Nếu câu hỏi nhắc tên thương hiệu, thêm joins:[{"resource":"Brand"}] và lọc "Brand.name".
- "đánh giá tốt nhất" = sort avg_rating DESC rồi review_count DESC.
- So sánh 2 sản phẩm = intent "compare_products", resource "Product", entities phải có 2 tên sản phẩm, limit 2.
- Gợi ý / tư vấn chung như "gợi ý cho mình", "tư vấn giùm", "có gì hay" = intent "recommend_products".
- Hỏi chi tiết / thông số 1 sản phẩm = intent "product_detail", resource "Product", entities có 1 tên sản phẩm, select name, description, origin_price, min_price, total_stock, brand_name, category_name, avg_rating, review_count, spec_summary, limit 1.
- Hỏi danh sách sản phẩm theo giá / hãng / danh mục = intent "product_search", resource "Product".
- Hỏi phiên bản / cấu hình / SKU = intent "variant_search", resource "ProductVariant", JOIN Product, select Product.name, display_name, attribute_summary, price, compare_at_price, stock_quantity.
- Nếu câu hỏi cho biết loại sản phẩm khi resource="ProductVariant" như "laptop", "điện thoại", "tablet", phải thêm filter phù hợp ở "Product.category_name" hoặc "Product.name", không được bỏ qua loại sản phẩm đó.
- Hỏi sản phẩm đang flash sale / sale sốc = intent "flash_sale_lookup", resource "FlashSaleItem".
- Hỏi đơn hàng của chính khách đã đăng nhập hoặc mã "ORD-..." = intent "order_lookup", resource "Order".
- Hỏi voucher / mã giảm giá = intent "coupon_lookup", resource "Coupon", chỉ lấy voucher public đang hoạt động.
- Hỏi bài viết / blog = intent "article_lookup", resource "Article".
- Hỏi hỗ trợ / ticket / vấn đề cần admin xử lý = intent "support_handoff".
- Chỉ khi thực sự không phải câu hỏi dữ liệu cửa hàng mới trả {"intent":"non_db","message":"<gợi ý lịch sự>"}.
- Không sinh SQL. Không bịa tên bảng/field.

${schemaText}

${fewShot}`,
};
