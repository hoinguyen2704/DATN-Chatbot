import { runReadOnly } from "../db/executor.js";

const PURCHASED_ORDER_STATUSES = ["COMPLETED", "SHIPPED", "PROCESSING"];
const PURCHASED_ORDER_STATUSES_SQL = PURCHASED_ORDER_STATUSES
  .map((status) => `'${status}'`)
  .join(", ");

/**
 * Gợi ý chung (anonymous user) — 3 query song song:
 *  1. SP nổi bật
 *  2. SP đánh giá cao
 *  3. Flash Sale đang diễn ra
 */
export async function getRecommendations() {
  const queries = [
    {
      key: "featured",
      sql: `
        SELECT
          id,
          name,
          min_price,
          total_stock,
          category_name,
          avg_rating,
          review_count
        FROM v_chatbot_products
        WHERE status = 'ACTIVE' AND is_featured = true
        ORDER BY created_at DESC
        LIMIT 5
      `,
    },
    {
      key: "topRated",
      sql: `
        SELECT
          id,
          name,
          min_price,
          total_stock,
          category_name,
          avg_rating,
          review_count
        FROM v_chatbot_products
        WHERE status = 'ACTIVE' AND review_count >= 1
        ORDER BY avg_rating DESC NULLS LAST, review_count DESC, created_at DESC
        LIMIT 5
      `,
    },
    {
      key: "flashSales",
      sql: `
        SELECT
          sale_name,
          end_time,
          product_name,
          display_name,
          attribute_summary,
          flash_price,
          flash_stock,
          sold_count
        FROM v_chatbot_flash_sale_items
        WHERE sale_status = 'ACTIVE'
        ORDER BY flash_price ASC
        LIMIT 5
      `,
    },
  ];

  const results = {};
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

/**
 * Gợi ý cá nhân hóa (authenticated user) — 4 query song song:
 *  1. SP cùng danh mục đã mua
 *  2. SP cùng thương hiệu đã mua
 *  3. SP thường được mua cùng
 *  4. SP phù hợp ngân sách
 */
export async function getPersonalizedRecommendations(userId) {
  if (!userId) return getRecommendations();

  console.log(`[RECOMMEND] Generating personalized for user=${userId}`);

  const queries = [
    {
      key: "sameCategory",
      label: "Dựa trên danh mục bạn đã mua",
      sql: `
        SELECT DISTINCT
          p.id,
          p.name,
          p.min_price,
          p.total_stock,
          p.category_name,
          p.avg_rating,
          p.review_count
        FROM v_chatbot_products p
        WHERE p.status = 'ACTIVE'
          AND p.category_id IN (
            SELECT DISTINCT category_id
            FROM v_chatbot_user_purchase_events
            WHERE user_id = $1
              AND order_status IN (${PURCHASED_ORDER_STATUSES_SQL})
              AND category_id IS NOT NULL
          )
          AND p.id NOT IN (
            SELECT DISTINCT product_id
            FROM v_chatbot_user_purchase_events
            WHERE user_id = $1
              AND order_status IN (${PURCHASED_ORDER_STATUSES_SQL})
          )
        ORDER BY COALESCE(p.avg_rating, 0) DESC, p.created_at DESC
        LIMIT 5
      `,
      params: [userId],
    },
    {
      key: "sameBrand",
      label: "Thương hiệu bạn yêu thích",
      sql: `
        SELECT DISTINCT
          p.id,
          p.name,
          p.min_price,
          p.brand_name,
          p.category_name
        FROM v_chatbot_products p
        WHERE p.status = 'ACTIVE'
          AND p.brand_id IS NOT NULL
          AND p.brand_id IN (
            SELECT DISTINCT brand_id
            FROM v_chatbot_user_purchase_events
            WHERE user_id = $1
              AND order_status IN (${PURCHASED_ORDER_STATUSES_SQL})
              AND brand_id IS NOT NULL
          )
          AND p.id NOT IN (
            SELECT DISTINCT product_id
            FROM v_chatbot_user_purchase_events
            WHERE user_id = $1
              AND order_status IN (${PURCHASED_ORDER_STATUSES_SQL})
          )
        ORDER BY p.created_at DESC
        LIMIT 5
      `,
      params: [userId],
    },
    {
      key: "coPurchase",
      label: "Khách hàng cũng thường mua",
      sql: `
        WITH user_products AS (
          SELECT DISTINCT product_id
          FROM v_chatbot_user_purchase_events
          WHERE user_id = $1
            AND order_status IN (${PURCHASED_ORDER_STATUSES_SQL})
        ),
        related_orders AS (
          SELECT DISTINCT order_id
          FROM v_chatbot_user_purchase_events
          WHERE order_status IN (${PURCHASED_ORDER_STATUSES_SQL})
            AND product_id IN (SELECT product_id FROM user_products)
        )
        SELECT
          p.id,
          p.name,
          p.min_price,
          p.category_name,
          COUNT(*)::INTEGER AS co_buy_count
        FROM v_chatbot_user_purchase_events e
        INNER JOIN v_chatbot_products p ON p.id = e.product_id
        WHERE e.order_status IN (${PURCHASED_ORDER_STATUSES_SQL})
          AND e.order_id IN (SELECT order_id FROM related_orders)
          AND e.product_id NOT IN (SELECT product_id FROM user_products)
          AND p.status = 'ACTIVE'
        GROUP BY p.id, p.name, p.min_price, p.category_name, p.created_at
        ORDER BY co_buy_count DESC, p.created_at DESC
        LIMIT 5
      `,
      params: [userId],
    },
    {
      key: "budgetMatch",
      label: "Phù hợp ngân sách của bạn",
      sql: `
        WITH user_avg AS (
          SELECT AVG(unit_price) AS avg_price
          FROM v_chatbot_user_purchase_events
          WHERE user_id = $1
            AND order_status IN (${PURCHASED_ORDER_STATUSES_SQL})
        )
        SELECT
          p.id,
          p.name,
          p.min_price,
          p.category_name,
          p.avg_rating,
          p.review_count
        FROM v_chatbot_products p
        CROSS JOIN user_avg ua
        WHERE p.status = 'ACTIVE'
          AND p.min_price IS NOT NULL
          AND ua.avg_price IS NOT NULL
          AND p.min_price BETWEEN ua.avg_price * 0.6 AND ua.avg_price * 1.4
          AND p.id NOT IN (
            SELECT DISTINCT product_id
            FROM v_chatbot_user_purchase_events
            WHERE user_id = $1
              AND order_status IN (${PURCHASED_ORDER_STATUSES_SQL})
          )
        ORDER BY COALESCE(p.avg_rating, 0) DESC, p.created_at DESC
        LIMIT 5
      `,
      params: [userId],
    },
  ];

  const results = { _personalized: true, _labels: {} };

  const promises = queries.map(async ({ key, label, sql, params }) => {
    try {
      const result = await runReadOnly(sql, params || [], 6000);
      results[key] = result.rows;
      results._labels[key] = label;
      console.log(`[RECOMMEND] ${key}: ${result.rows.length} rows`);
    } catch (err) {
      console.warn(`[RECOMMEND] Personalized "${key}" failed:`, err.message);
      results[key] = [];
    }
  });

  await Promise.all(promises);

  const totalPersonalized =
    (results.sameCategory?.length || 0) +
    (results.sameBrand?.length || 0) +
    (results.coPurchase?.length || 0) +
    (results.budgetMatch?.length || 0);

  if (totalPersonalized === 0) {
    console.log("[RECOMMEND] No personalized data, falling back to generic");
    const generic = await getRecommendations();
    return { ...generic, _personalized: false };
  }

  try {
    const flashResult = await runReadOnly(
      `SELECT
          sale_name,
          end_time,
          product_name,
          display_name,
          attribute_summary,
          flash_price,
          flash_stock,
          sold_count
       FROM v_chatbot_flash_sale_items
       WHERE sale_status = 'ACTIVE'
       ORDER BY flash_price ASC
       LIMIT 5`,
      [],
      6000,
    );
    results.flashSales = flashResult.rows;
  } catch (err) {
    console.warn("[RECOMMEND] flashSales failed:", err.message);
    results.flashSales = [];
  }

  return results;
}
