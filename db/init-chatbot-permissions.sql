-- ============================================================
-- Hozitech Chatbot — Quyền hạn Database (PostgreSQL)
-- Chạy script này bằng tài khoản superadmin/postgres
-- ============================================================

-- 1. Tạo user read-only cho chatbot
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'chatbot_read_only') THEN
    CREATE ROLE chatbot_read_only WITH LOGIN PASSWORD 'postgres';
  END IF;
END
$$;

-- 2. Cấp quyền kết nối vào database hiện tại
DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO chatbot_read_only',
    current_database()
  );
END
$$;

-- 3. Cấp quyền đọc schema public
GRANT USAGE ON SCHEMA public TO chatbot_read_only;

-- 4. Cấp quyền SELECT trên các bảng chatbot cần truy vấn
GRANT SELECT ON TABLE
  products,
  product_variants,
  product_images,
  categories,
  brands,
  users,
  orders,
  order_items,
  coupons,
  flash_sales,
  flash_sale_items,
  feedbacks,
  articles
TO chatbot_read_only;

-- 5. Tạo VIEW thống kê đánh giá nếu chưa tồn tại
DO $$
BEGIN
  IF to_regclass('public.v_feedback_stats') IS NULL THEN
    EXECUTE $view$
      CREATE VIEW v_feedback_stats AS
      SELECT
          product_id,
          ROUND(AVG(rating), 1)  AS avg_rating,
          COUNT(*)               AS review_count,
          MAX(created_at)        AS last_review_at
      FROM feedbacks
      WHERE status = 'APPROVED'
      GROUP BY product_id
    $view$;
  END IF;
END
$$;

-- 6. Tạo VIEW tóm tắt giá & tồn kho sản phẩm nếu chưa tồn tại
DO $$
BEGIN
  IF to_regclass('public.v_product_summary') IS NULL THEN
    EXECUTE $view$
      CREATE VIEW v_product_summary AS
      SELECT
          product_id,
          MIN(price)                        AS min_price,
          MAX(price)                        AS max_price,
          COALESCE(SUM(stock_quantity), 0)  AS total_stock
      FROM product_variants
      WHERE status = true
      GROUP BY product_id
    $view$;
  END IF;
END
$$;

-- 7. Tạo read-model riêng cho chatbot sau cutover schema
CREATE OR REPLACE VIEW v_chatbot_products AS
WITH variant_stats AS (
  SELECT
    pv.product_id,
    MIN(pv.price) FILTER (WHERE COALESCE(pv.status, TRUE) = TRUE) AS min_price,
    MAX(pv.price) FILTER (WHERE COALESCE(pv.status, TRUE) = TRUE) AS max_price,
    COALESCE(
      SUM(pv.stock_quantity) FILTER (WHERE COALESCE(pv.status, TRUE) = TRUE),
      0
    )::INTEGER AS total_stock
  FROM product_variants pv
  GROUP BY pv.product_id
),
feedback_stats AS (
  SELECT
    f.product_id,
    ROUND(AVG(f.rating), 1) AS avg_rating,
    COUNT(*)::INTEGER AS review_count
  FROM feedbacks f
  WHERE f.status = 'APPROVED'
  GROUP BY f.product_id
),
spec_summary AS (
  SELECT
    psv.product_id,
    string_agg(
      CONCAT(sa.name, ': ', psv.value_text),
      E'\n'
      ORDER BY COALESCE(csa.sort_order, sa.sort_order, 0), sa.name
    ) AS spec_summary
  FROM product_spec_values psv
  INNER JOIN products p ON p.id = psv.product_id
  INNER JOIN spec_attributes sa ON sa.id = psv.spec_attribute_id
  LEFT JOIN category_spec_attributes csa
    ON csa.category_id = p.category_id
   AND csa.spec_attribute_id = psv.spec_attribute_id
  GROUP BY psv.product_id
),
main_images AS (
  SELECT DISTINCT ON (pi.product_id)
    pi.product_id,
    pi.image_url AS main_image_url
  FROM product_images pi
  WHERE pi.variant_id IS NULL
  ORDER BY
    pi.product_id,
    pi.is_primary DESC,
    pi.sort_order ASC,
    pi.created_at ASC
)
SELECT
  p.id,
  p.name,
  p.slug,
  p.description,
  p.origin_price,
  p.status,
  p.is_featured,
  p.category_id,
  c.name AS category_name,
  p.brand_id,
  b.name AS brand_name,
  p.created_at,
  vs.min_price,
  vs.max_price,
  COALESCE(vs.total_stock, 0)::INTEGER AS total_stock,
  fs.avg_rating,
  COALESCE(fs.review_count, 0)::INTEGER AS review_count,
  mi.main_image_url,
  ss.spec_summary
FROM products p
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN brands b ON b.id = p.brand_id
LEFT JOIN variant_stats vs ON vs.product_id = p.id
LEFT JOIN feedback_stats fs ON fs.product_id = p.id
LEFT JOIN spec_summary ss ON ss.product_id = p.id
LEFT JOIN main_images mi ON mi.product_id = p.id;

CREATE OR REPLACE VIEW v_chatbot_product_variants AS
WITH attribute_summary AS (
  SELECT
    pvav.product_variant_id,
    string_agg(
      CONCAT(va.name, ': ', vao.label),
      ' | '
      ORDER BY
        COALESCE(cva.sort_order, 0),
        COALESCE(vao.sort_order, 0),
        va.name,
        vao.label
    ) AS attribute_summary
  FROM product_variant_attribute_values pvav
  INNER JOIN product_variants pv ON pv.id = pvav.product_variant_id
  INNER JOIN products p ON p.id = pv.product_id
  INNER JOIN variant_attributes va ON va.id = pvav.variant_attribute_id
  INNER JOIN variant_attribute_options vao ON vao.id = pvav.option_id
  LEFT JOIN category_variant_attributes cva
    ON cva.category_id = p.category_id
   AND cva.variant_attribute_id = pvav.variant_attribute_id
  GROUP BY pvav.product_variant_id
)
SELECT
  pv.id,
  pv.product_id,
  p.name AS product_name,
  p.slug AS product_slug,
  p.category_id,
  c.name AS category_name,
  p.brand_id,
  b.name AS brand_name,
  pv.sku,
  pv.display_name,
  pv.variant_signature,
  pv.price,
  pv.compare_at_price,
  pv.stock_quantity,
  pv.status,
  pv.created_at,
  attr.attribute_summary
FROM product_variants pv
INNER JOIN products p ON p.id = pv.product_id
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN brands b ON b.id = p.brand_id
LEFT JOIN attribute_summary attr ON attr.product_variant_id = pv.id;

CREATE OR REPLACE VIEW v_chatbot_flash_sale_items AS
SELECT
  f.id AS flash_sale_id,
  f.name AS sale_name,
  f.status AS sale_status,
  f.start_time,
  f.end_time,
  fi.variant_id,
  cv.product_id,
  cv.product_name,
  cv.product_slug,
  cv.category_name,
  cv.brand_name,
  cv.display_name,
  cv.attribute_summary,
  fi.flash_price,
  fi.flash_stock,
  fi.sold_count
FROM flash_sales f
INNER JOIN flash_sale_items fi ON fi.flash_sale_id = f.id
INNER JOIN v_chatbot_product_variants cv ON cv.id = fi.variant_id;

CREATE OR REPLACE VIEW v_chatbot_user_purchase_events AS
SELECT
  o.user_id,
  o.id AS order_id,
  o.order_status,
  o.created_at AS ordered_at,
  oi.variant_id,
  pv.product_id,
  p.category_id,
  c.name AS category_name,
  p.brand_id,
  b.name AS brand_name,
  oi.unit_price,
  oi.quantity,
  oi.subtotal,
  p.name AS product_name,
  pv.display_name,
  p.status AS product_status,
  pv.status AS variant_status,
  u.email AS user_email
FROM orders o
INNER JOIN users u ON u.id = o.user_id
INNER JOIN order_items oi ON oi.order_id = o.id
INNER JOIN product_variants pv ON pv.id = oi.variant_id
INNER JOIN products p ON p.id = pv.product_id
LEFT JOIN categories c ON c.id = p.category_id
LEFT JOIN brands b ON b.id = p.brand_id;

CREATE OR REPLACE VIEW v_chatbot_orders AS
WITH order_item_summary AS (
  SELECT
    oi.order_id,
    COUNT(*)::INTEGER AS item_count,
    string_agg(
      CONCAT(
        p.name,
        CASE
          WHEN pv.display_name IS NOT NULL
           AND btrim(pv.display_name) <> ''
           AND pv.display_name <> p.name
          THEN CONCAT(' - ', pv.display_name)
          ELSE ''
        END,
        ' x',
        oi.quantity
      ),
      '; '
      ORDER BY oi.created_at ASC, p.name ASC
    ) AS item_summary
  FROM order_items oi
  INNER JOIN product_variants pv ON pv.id = oi.variant_id
  INNER JOIN products p ON p.id = pv.product_id
  GROUP BY oi.order_id
)
SELECT
  o.user_id,
  u.email AS user_email,
  o.id AS order_id,
  o.order_number,
  o.created_at,
  o.order_status,
  o.payment_status,
  o.tracking_code,
  o.subtotal,
  o.shipping_fee,
  o.discount_amount,
  o.total_amount,
  COALESCE(oi.item_count, 0)::INTEGER AS item_count,
  oi.item_summary
FROM orders o
INNER JOIN users u ON u.id = o.user_id
LEFT JOIN order_item_summary oi ON oi.order_id = o.id;

-- 8. Cấp quyền SELECT trên các read-model view mới
GRANT SELECT ON TABLE
  v_chatbot_products,
  v_chatbot_product_variants,
  v_chatbot_flash_sale_items,
  v_chatbot_user_purchase_events,
  v_chatbot_orders
TO chatbot_read_only;

-- 8b. Giữ grant cho legacy views nếu current user là owner của chúng
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'v_feedback_stats'
      AND pg_get_userbyid(c.relowner) = current_user
  ) THEN
    EXECUTE 'GRANT SELECT ON TABLE v_feedback_stats TO chatbot_read_only';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'v_product_summary'
      AND pg_get_userbyid(c.relowner) = current_user
  ) THEN
    EXECUTE 'GRANT SELECT ON TABLE v_product_summary TO chatbot_read_only';
  END IF;
END
$$;

-- 9. Tự động cấp quyền SELECT cho các bảng/view tạo mới trong tương lai (tuỳ chọn)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO chatbot_read_only;

-- ============================================================
-- ✅ HOÀN TẤT! Chatbot user "chatbot_read_only" chỉ có quyền:
--   • CONNECT vào database
--   • SELECT trên các bảng public cần thiết + read-model view cho chatbot
--   • KHÔNG CÓ quyền INSERT, UPDATE, DELETE, DROP
-- ============================================================
