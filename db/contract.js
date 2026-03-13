export const CONTRACT = {
  resources: {
    // ─── SẢN PHẨM ───
    Product: {
      view: "products",
      description: "Sản phẩm đang bán trên cửa hàng Hozitech",
      aliases: [
        "product", "sản phẩm", "sp", "san pham",
        "hàng", "đồ", "thiết bị", "máy",
      ],
      fields: {
        id:           { type: "uuid",      description: "Mã sản phẩm" },
        name:         { type: "text",      description: "Tên sản phẩm" },
        slug:         { type: "text",      description: "Slug URL" },
        description:  { type: "text",      description: "Mô tả sản phẩm" },
        origin_price: { type: "number",    description: "Giá gốc (VNĐ)" },
        specs_json:   { type: "jsonb",     description: "Thông số kỹ thuật (JSON)" },
        status:       { type: "text",      description: "Trạng thái (ACTIVE, INACTIVE, DRAFT)" },
        is_featured:  { type: "boolean",   description: "Sản phẩm nổi bật" },
        category_id:  { type: "uuid",      description: "Mã danh mục" },
        brand_id:     { type: "uuid",      description: "Mã thương hiệu" },
        created_at:   { type: "timestamp", description: "Ngày tạo" },
      },
      defaultSelect: ["id", "name", "origin_price", "status", "is_featured"],
      filterable: true,
      sortable: true,
      relations: {
        Category: {
          type: "inner",
          localField: "category_id",
          foreignResource: "Category",
          foreignField: "id",
          alias: "c",
        },
        Brand: {
          type: "left",
          localField: "brand_id",
          foreignResource: "Brand",
          foreignField: "id",
          alias: "b",
        },
        FeedbackStat: {
          type: "left",
          localField: "id",
          foreignResource: "FeedbackStat",
          foreignField: "product_id",
          alias: "fs",
        },
        MinVariant: {
          type: "left",
          localField: "id",
          foreignResource: "MinVariant",
          foreignField: "product_id",
          alias: "mv",
        },
      },
    },

    // ─── BIẾN THỂ SẢN PHẨM ───
    ProductVariant: {
      view: "product_variants",
      description: "Biến thể sản phẩm (SKU, màu, dung lượng, giá, tồn kho)",
      aliases: ["variant", "biến thể", "phiên bản", "cấu hình", "sku"],
      fields: {
        id:               { type: "uuid",    description: "Mã biến thể" },
        sku:              { type: "text",    description: "Mã SKU" },
        variant_name:     { type: "text",    description: "Tên biến thể (VD: 8GB/256GB Đen)" },
        color:            { type: "text",    description: "Màu sắc" },
        capacity:         { type: "text",    description: "Dung lượng (VD: 256GB, 512GB)" },
        price:            { type: "number",  description: "Giá bán thực tế (VNĐ)" },
        compare_at_price: { type: "number",  description: "Giá so sánh / giá gốc (VNĐ)" },
        stock_quantity:   { type: "number",  description: "Số lượng tồn kho" },
        status:           { type: "boolean", description: "Đang hoạt động (true/false)" },
        product_id:       { type: "uuid",    description: "Mã sản phẩm cha" },
        created_at:       { type: "timestamp", description: "Ngày tạo" },
      },
      defaultSelect: ["id", "sku", "variant_name", "price", "stock_quantity"],
      filterable: true,
      sortable: true,
      relations: {
        Product: {
          type: "inner",
          localField: "product_id",
          foreignResource: "Product",
          foreignField: "id",
          alias: "p",
        },
      },
    },

    // ─── DANH MỤC ───
    Category: {
      view: "categories",
      description: "Danh mục sản phẩm (hỗ trợ phân cấp cha-con)",
      aliases: ["category", "danh mục", "loại", "nhóm hàng", "danh_muc"],
      fields: {
        id:         { type: "uuid",    description: "Mã danh mục" },
        name:       { type: "text",    description: "Tên danh mục" },
        slug:       { type: "text",    description: "Slug URL" },
        parent_id:  { type: "uuid",    description: "Mã danh mục cha (null = gốc)" },
        sort_order: { type: "number",  description: "Thứ tự sắp xếp" },
        status:     { type: "boolean", description: "Đang hiển thị" },
        created_at: { type: "timestamp", description: "Ngày tạo" },
      },
      defaultSelect: ["id", "name", "slug"],
      filterable: true,
      sortable: true,
    },

    // ─── THƯƠNG HIỆU ───
    Brand: {
      view: "brands",
      description: "Thương hiệu sản phẩm (Apple, Samsung, Xiaomi...)",
      aliases: ["brand", "thương hiệu", "hãng", "nhà sản xuất", "hang"],
      fields: {
        id:       { type: "uuid", description: "Mã thương hiệu" },
        name:     { type: "text", description: "Tên thương hiệu" },
        slug:     { type: "text", description: "Slug URL" },
        logo_url: { type: "text", description: "URL logo" },
      },
      defaultSelect: ["id", "name"],
      filterable: true,
      sortable: true,
    },

    // ─── MÃ GIẢM GIÁ ───
    Coupon: {
      view: "coupons",
      description: "Mã giảm giá / Voucher khuyến mãi",
      aliases: ["coupon", "voucher", "mã giảm giá", "khuyến mãi", "km", "mã khuyến mãi"],
      fields: {
        id:                  { type: "uuid",      description: "Mã coupon" },
        code:                { type: "text",      description: "Mã code (VD: SALE50K)" },
        discount_type:       { type: "text",      description: "Loại giảm: PERCENTAGE hoặc FIXED_AMOUNT" },
        discount_value:      { type: "number",    description: "Giá trị giảm (% hoặc VNĐ)" },
        min_order_value:     { type: "number",    description: "Đơn hàng tối thiểu để áp dụng" },
        max_discount_amount: { type: "number",    description: "Số tiền giảm tối đa" },
        usage_limit:         { type: "number",    description: "Giới hạn lượt sử dụng" },
        used_count:          { type: "number",    description: "Số lượt đã dùng" },
        start_date:          { type: "timestamp", description: "Ngày bắt đầu" },
        end_date:            { type: "timestamp", description: "Ngày kết thúc" },
        status:              { type: "text",      description: "Trạng thái (ACTIVE, EXPIRED, PAUSED)" },
      },
      defaultSelect: ["code", "discount_type", "discount_value", "end_date", "status"],
      filterable: true,
      sortable: true,
    },

    // ─── FLASH SALE ───
    FlashSale: {
      view: "flash_sales",
      description: "Chương trình Flash Sale / Deal sốc",
      aliases: ["flash sale", "deal", "giảm giá sốc", "khuyến mãi sốc", "deal sốc"],
      fields: {
        id:          { type: "uuid",      description: "Mã flash sale" },
        name:        { type: "text",      description: "Tên chương trình" },
        description: { type: "text",      description: "Mô tả" },
        start_time:  { type: "timestamp", description: "Thời gian bắt đầu" },
        end_time:    { type: "timestamp", description: "Thời gian kết thúc" },
        status:      { type: "text",      description: "Trạng thái: SCHEDULED, ACTIVE, ENDED" },
      },
      defaultSelect: ["id", "name", "start_time", "end_time", "status"],
      filterable: true,
      sortable: true,
    },

    // ─── ĐÁNH GIÁ (VIEW THỐNG KÊ) ───
    FeedbackStat: {
      view: "v_feedback_stats",
      description: "Thống kê đánh giá trung bình theo sản phẩm",
      fields: {
        product_id:     { type: "uuid",      description: "Mã sản phẩm" },
        avg_rating:     { type: "number",    description: "Điểm đánh giá trung bình (1-5)" },
        review_count:   { type: "number",    description: "Số lượt đánh giá" },
        last_review_at: { type: "timestamp", description: "Thời gian đánh giá gần nhất" },
      },
      defaultSelect: ["product_id", "avg_rating", "review_count"],
    },

    // ─── GIÁ TỐI THIỂU VARIANT (VIEW) ───
    MinVariant: {
      view: "v_product_summary",
      description: "Giá rẻ nhất và tổng tồn kho của sản phẩm (từ variants)",
      fields: {
        product_id:  { type: "uuid",   description: "Mã sản phẩm" },
        min_price:   { type: "number", description: "Giá rẻ nhất trong các biến thể" },
        max_price:   { type: "number", description: "Giá đắt nhất" },
        total_stock: { type: "number", description: "Tổng tồn kho tất cả biến thể" },
      },
      defaultSelect: ["product_id", "min_price", "total_stock"],
    },

    // ─── BÀI VIẾT ───
    Article: {
      view: "articles",
      description: "Bài viết công nghệ / tin tức",
      aliases: ["article", "bài viết", "tin tức", "blog", "tin công nghệ"],
      fields: {
        id:           { type: "uuid",      description: "Mã bài viết" },
        title:        { type: "text",      description: "Tiêu đề" },
        slug:         { type: "text",      description: "Slug URL" },
        is_published: { type: "boolean",   description: "Đã xuất bản" },
        created_at:   { type: "timestamp", description: "Ngày tạo" },
      },
      defaultSelect: ["id", "title", "slug", "created_at"],
      filterable: true,
      sortable: true,
    },
  },
};
