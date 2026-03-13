export const fewShotExamples = `Ví dụ:

Q: "Cửa hàng có những loại điện thoại nào?"
A: {"resource":"Product",
    "joins":[{"resource":"Category"},{"resource":"MinVariant"}],
    "select":["id","name","MinVariant.min_price","Category.name"],
    "where":[{"field":"Category.name","op":"contains","value":"điện thoại"},
             {"field":"status","op":"eq","value":"ACTIVE"}],
    "limit":10}

Q: "Tôi muốn mua laptop"
A: {"resource":"Product",
    "joins":[{"resource":"Category"},{"resource":"MinVariant"}],
    "select":["id","name","MinVariant.min_price","MinVariant.total_stock","Category.name"],
    "where":[{"field":"Category.name","op":"contains","value":"laptop"},
             {"field":"status","op":"eq","value":"ACTIVE"}],
    "limit":10}

Q: "Điện thoại Samsung giá dưới 10 triệu"
A: {"resource":"Product",
    "joins":[{"resource":"Category"},{"resource":"Brand"},{"resource":"MinVariant"}],
    "select":["id","name","Brand.name","MinVariant.min_price","Category.name"],
    "where":[{"field":"Category.name","op":"contains","value":"điện thoại"},
             {"field":"Brand.name","op":"contains","value":"samsung"},
             {"field":"MinVariant.min_price","op":"lte","value":10000000},
             {"field":"status","op":"eq","value":"ACTIVE"}],
    "sort":[{"field":"MinVariant.min_price","dir":"asc"}],
    "limit":5}

Q: "Laptop nào đang giảm giá?"
A: {"resource":"ProductVariant",
    "joins":[{"resource":"Product"}],
    "select":["Product.name","variant_name","price","compare_at_price","stock_quantity"],
    "where":[{"field":"compare_at_price","op":"gt","value":0},
             {"field":"status","op":"eq","value":true}],
    "sort":[{"field":"price","dir":"asc"}],
    "limit":10}

Q: "Sản phẩm nào có đánh giá tốt nhất?"
A: {"resource":"Product",
    "joins":[{"resource":"FeedbackStat"},{"resource":"MinVariant"}],
    "select":["id","name","MinVariant.min_price","FeedbackStat.avg_rating","FeedbackStat.review_count"],
    "where":[{"field":"FeedbackStat.review_count","op":"gte","value":1},
             {"field":"status","op":"eq","value":"ACTIVE"}],
    "sort":[{"field":"FeedbackStat.avg_rating","dir":"desc"},
            {"field":"FeedbackStat.review_count","dir":"desc"}],
    "limit":5}

Q: "Sản phẩm nổi bật"
A: {"resource":"Product",
    "joins":[{"resource":"Category"},{"resource":"MinVariant"}],
    "select":["id","name","MinVariant.min_price","Category.name"],
    "where":[{"field":"is_featured","op":"eq","value":true},
             {"field":"status","op":"eq","value":"ACTIVE"}],
    "limit":10}

Q: "iPhone 15 có mấy phiên bản?"
A: {"resource":"ProductVariant",
    "joins":[{"resource":"Product"}],
    "select":["sku","variant_name","color","capacity","price","compare_at_price","stock_quantity"],
    "where":[{"field":"Product.name","op":"contains","value":"iphone 15"},
             {"field":"status","op":"eq","value":true}],
    "limit":10}

Q: "Có mã giảm giá nào đang dùng được không?"
A: {"resource":"Coupon",
    "select":["code","discount_type","discount_value","min_order_value","end_date"],
    "where":[{"field":"status","op":"eq","value":"ACTIVE"}],
    "sort":[{"field":"end_date","dir":"asc"}],
    "limit":5}

Q: "Có chương trình flash sale nào không?"
A: {"resource":"FlashSale",
    "select":["name","description","start_time","end_time","status"],
    "where":[{"field":"status","op":"eq","value":"ACTIVE"}],
    "limit":5}

Q: "Cửa hàng có những danh mục gì?"
A: {"resource":"Category",
    "select":["id","name","slug"],
    "where":[{"field":"status","op":"eq","value":true}],
    "sort":[{"field":"sort_order","dir":"asc"}],
    "limit":20}

Q: "Có thương hiệu nào?"
A: {"resource":"Brand",
    "select":["id","name"],
    "limit":20}

Q: "Có bài viết mới nào không?"
A: {"resource":"Article",
    "select":["title","slug","created_at"],
    "where":[{"field":"is_published","op":"eq","value":true}],
    "sort":[{"field":"created_at","dir":"desc"}],
    "limit":5}

Q: "Gợi ý sản phẩm cho mình" / "Tư vấn giùm" / "Có gì hay không?"
A: {"mode":"recommend","intent":"general"}

Q: "Chào bạn" / "Bạn là ai?" / "Thời tiết hôm nay"
A: {"message":"Chào bạn! Mình là trợ lý AI của Hozitech. Bạn muốn tìm hiểu về sản phẩm, đơn hàng, hay khuyến mãi nào ạ?"}`;
