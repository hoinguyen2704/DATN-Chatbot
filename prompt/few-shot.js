export const fewShotExamples = `Ví dụ:

Q: "iPhone 17 Pro Max có thông số gì vượt trội so với S26 Ultra"
A: {"intent":"compare_products",
    "resource":"Product",
    "entities":["iphone 17 pro max","s26 ultra"],
    "select":["name","min_price","total_stock","avg_rating","review_count","brand_name","category_name","spec_summary"],
    "where":[{"field":"status","op":"eq","value":"ACTIVE"}],
    "sort":[],
    "limit":2}

Q: "Gợi ý điện thoại cho mình"
A: {"intent":"recommend_products"}

Q: "Điện thoại Samsung giá dưới 10 triệu"
A: {"intent":"product_search",
    "resource":"Product",
    "entities":["samsung","điện thoại"],
    "joins":[{"resource":"Category"},{"resource":"Brand"}],
    "select":["id","name","min_price","total_stock","brand_name","category_name"],
    "where":[{"field":"Category.name","op":"contains","value":"điện thoại"},
             {"field":"Brand.name","op":"contains","value":"samsung"},
             {"field":"min_price","op":"lte","value":10000000},
             {"field":"status","op":"eq","value":"ACTIVE"}],
    "sort":[{"field":"min_price","dir":"asc"}],
    "limit":5}

Q: "Laptop nào đang giảm giá?"
A: {"intent":"variant_search",
    "resource":"ProductVariant",
    "entities":["laptop"],
    "joins":[{"resource":"Product"}],
    "select":["Product.name","display_name","attribute_summary","price","compare_at_price","stock_quantity"],
    "where":[{"field":"Product.category_name","op":"contains","value":"laptop"},
             {"field":"Product.status","op":"eq","value":"ACTIVE"},
             {"field":"compare_at_price","op":"gt","value":0},
             {"field":"status","op":"eq","value":true}],
    "sort":[{"field":"price","dir":"asc"}],
    "limit":5}

Q: "Flash sale hôm nay có gì?"
A: {"intent":"flash_sale_lookup",
    "resource":"FlashSaleItem",
    "select":["sale_name","product_name","display_name","attribute_summary","flash_price","flash_stock","sold_count","end_time"],
    "where":[{"field":"sale_status","op":"eq","value":"ACTIVE"}],
    "sort":[{"field":"end_time","dir":"asc"}],
    "limit":5}

Q: "Chi tiết iPhone 15"
A: {"intent":"product_detail",
    "resource":"Product",
    "entities":["iphone 15"],
    "select":["name","description","origin_price","min_price","total_stock","brand_name","category_name","avg_rating","review_count","spec_summary"],
    "where":[{"field":"name","op":"contains","value":"iphone 15"},
             {"field":"status","op":"eq","value":"ACTIVE"}],
    "limit":1}

Q: "Có mã giảm giá nào đang dùng được không?"
A: {"intent":"coupon_lookup",
    "resource":"Coupon",
    "select":["code","discount_type","discount_value","min_order_value","end_date","status","is_public"],
    "where":[{"field":"status","op":"eq","value":"ACTIVE"},
             {"field":"is_public","op":"eq","value":true}],
    "sort":[{"field":"end_date","dir":"asc"}],
    "limit":5}

Q: "Tra cứu đơn hàng ORD-20260502-98BC27"
A: {"intent":"order_lookup",
    "resource":"Order",
    "entities":["ORD-20260502-98BC27"],
    "select":["order_number","created_at","order_status","payment_status","tracking_code","total_amount","item_count","item_summary"],
    "where":[{"field":"order_number","op":"eq","value":"ORD-20260502-98BC27"}],
    "sort":[{"field":"created_at","dir":"desc"}],
    "limit":1}

Q: "Tôi cần hỗ trợ đơn hàng này"
A: {"intent":"support_handoff"}

Q: "Có bài viết mới nào không?"
A: {"intent":"article_lookup",
    "resource":"Article",
    "select":["title","slug","created_at"],
    "where":[{"field":"is_published","op":"eq","value":true}],
    "sort":[{"field":"created_at","dir":"desc"}],
    "limit":5}

Q: "Bạn là ai?"
A: {"intent":"non_db","message":"Mình là trợ lý của cửa hàng, có thể hỗ trợ tra cứu sản phẩm và khuyến mãi."}`;
