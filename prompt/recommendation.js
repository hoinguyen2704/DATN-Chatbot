import { runReadOnly } from "../db/executor.js";

/**
 * Gợi ý sản phẩm thông minh — chạy song song 3 query:
 *  1. SP nổi bật (is_featured = true)
 *  2. SP đánh giá cao nhất (từ v_feedback_stats)
 *  3. Flash Sale đang diễn ra (status = ACTIVE)
 *
 * Trả về object { featured, topRated, flashSales } chứa rows.
 */
export async function getRecommendations() {
  const queries = [
    // 1. SP nổi bật + giá rẻ nhất
    {
      key: "featured",
      sql: `
        SELECT p."id", p."name", mv."min_price", mv."total_stock", c."name" AS category_name
        FROM products p
        INNER JOIN categories c ON p."category_id" = c."id"
        LEFT JOIN v_product_summary mv ON p."id" = mv."product_id"
        WHERE p."status" = 'ACTIVE' AND p."is_featured" = true
        ORDER BY p."created_at" DESC
        LIMIT 5
      `,
    },
    // 2. SP đánh giá cao nhất
    {
      key: "topRated",
      sql: `
        SELECT p."id", p."name", mv."min_price",
               fs."avg_rating", fs."review_count", c."name" AS category_name
        FROM products p
        INNER JOIN categories c ON p."category_id" = c."id"
        LEFT JOIN v_product_summary mv ON p."id" = mv."product_id"
        INNER JOIN v_feedback_stats fs ON p."id" = fs."product_id"
        WHERE p."status" = 'ACTIVE' AND fs."review_count" >= 1
        ORDER BY fs."avg_rating" DESC, fs."review_count" DESC
        LIMIT 5
      `,
    },
    // 3. Flash Sale đang diễn ra
    {
      key: "flashSales",
      sql: `
        SELECT f."name" AS sale_name, f."end_time",
               pv."variant_name", fi."flash_price", fi."flash_stock", fi."sold_count"
        FROM flash_sales f
        INNER JOIN flash_sale_items fi ON f."id" = fi."flash_sale_id"
        INNER JOIN product_variants pv ON fi."variant_id" = pv."id"
        WHERE f."status" = 'ACTIVE'
        ORDER BY fi."flash_price" ASC
        LIMIT 5
      `,
    },
  ];

  const results = {};

  // Chạy song song tất cả query
  const promises = queries.map(async ({ key, sql }) => {
    try {
      const result = await runReadOnly(sql, [], 6000);
      results[key] = result.rows;
    } catch (err) {
      console.warn(`[RECOMMEND] Query "${key}" failed:`, err.message);
      results[key] = [];
    }
  });

  await Promise.all(promises);
  return results;
}
