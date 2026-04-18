export const fewShotExamples = `Ví dụ:

Q: "Điện thoại Samsung giá dưới 10 triệu"
A: {"resource":"Product",
    "joins":[{"resource":"Category"},{"resource":"Brand"}],
    "select":["id","name","min_price","total_stock","brand_name","category_name"],
    "where":[{"field":"Category.name","op":"contains","value":"điện thoại"},
             {"field":"Brand.name","op":"contains","value":"samsung"},
             {"field":"min_price","op":"lte","value":10000000},
             {"field":"status","op":"eq","value":"ACTIVE"}],
    "sort":[{"field":"min_price","dir":"asc"}],
    "limit":5}

Q: "Laptop nào đang giảm giá?"
A: {"resource":"ProductVariant",
    "joins":[{"resource":"Product"}],
    "select":["Product.name","display_name","attribute_summary","price","compare_at_price","stock_quantity"],
    "where":[{"field":"Product.status","op":"eq","value":"ACTIVE"},
             {"field":"compare_at_price","op":"gt","value":0},
             {"field":"status","op":"eq","value":true}],
    "sort":[{"field":"price","dir":"asc"}],
    "limit":5}

Q: "Chi tiết iPhone 15"
A: {"resource":"Product",
    "select":["name","description","origin_price","min_price","total_stock","brand_name","category_name","avg_rating","review_count","spec_summary"],
    "where":[{"field":"name","op":"contains","value":"iphone 15"},
             {"field":"status","op":"eq","value":"ACTIVE"}],
    "limit":1}

Q: "Có mã giảm giá nào đang dùng được không?"
A: {"resource":"Coupon",
    "select":["code","discount_type","discount_value","min_order_value","end_date"],
    "where":[{"field":"status","op":"eq","value":"ACTIVE"}],
    "sort":[{"field":"end_date","dir":"asc"}],
    "limit":5}

Q: "Có bài viết mới nào không?"
A: {"resource":"Article",
    "select":["title","slug","created_at"],
    "where":[{"field":"is_published","op":"eq","value":true}],
    "sort":[{"field":"created_at","dir":"desc"}],
    "limit":5}`;
