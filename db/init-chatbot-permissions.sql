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

-- 2. Cấp quyền kết nối vào database
GRANT CONNECT ON DATABASE hozitechdb TO chatbot_read_only;

-- 3. Cấp quyền đọc schema public
GRANT USAGE ON SCHEMA public TO chatbot_read_only;

-- 4. Cấp quyền SELECT trên các bảng chatbot cần truy vấn
GRANT SELECT ON TABLE
  products,
  product_variants,
  product_images,
  categories,
  brands,
  coupons,
  flash_sales,
  flash_sale_items,
  feedbacks,
  articles
TO chatbot_read_only;

-- 5. Tạo VIEW thống kê đánh giá
CREATE OR REPLACE VIEW v_feedback_stats AS
SELECT
    product_id,
    ROUND(AVG(rating), 1)  AS avg_rating,
    COUNT(*)               AS review_count,
    MAX(created_at)        AS last_review_at
FROM feedbacks
WHERE status = 'APPROVED'
GROUP BY product_id;

-- 6. Tạo VIEW tóm tắt giá & tồn kho sản phẩm
CREATE OR REPLACE VIEW v_product_summary AS
SELECT
    product_id,
    MIN(price)                        AS min_price,
    MAX(price)                        AS max_price,
    COALESCE(SUM(stock_quantity), 0)  AS total_stock
FROM product_variants
WHERE status = true
GROUP BY product_id;

-- 7. Cấp quyền SELECT trên các VIEW
GRANT SELECT ON TABLE
  v_feedback_stats,
  v_product_summary
TO chatbot_read_only;

-- 8. Tự động cấp quyền SELECT cho các bảng/view tạo mới trong tương lai (tuỳ chọn)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO chatbot_read_only;

-- ============================================================
-- ✅ HOÀN TẤT! Chatbot user "chatbot_read_only" chỉ có quyền:
--   • CONNECT vào database
--   • SELECT trên 10 bảng + 2 view
--   • KHÔNG CÓ quyền INSERT, UPDATE, DELETE, DROP
-- ============================================================
