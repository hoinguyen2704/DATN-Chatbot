import { runReadOnly } from "../db/executor.js";

const PURCHASED_ORDER_STATUSES = ["CONFIRMED", "PROCESSING", "SHIPPING", "SHIPPED"];
const PURCHASED_ORDER_STATUSES_SQL = PURCHASED_ORDER_STATUSES
  .map((status) => `'${status}'`)
  .join(", ");
const PURCHASED_PAYMENT_STATUSES = ["COMPLETED"];
const PURCHASED_PAYMENT_STATUSES_SQL = PURCHASED_PAYMENT_STATUSES
  .map((status) => `'${status}'`)
  .join(", ");
const PURCHASE_EVENT_SQL = `(
  order_status IN (${PURCHASED_ORDER_STATUSES_SQL})
  OR payment_status IN (${PURCHASED_PAYMENT_STATUSES_SQL})
)`;
const ORDER_PURCHASE_EVENT_SQL = `order_status IN (${PURCHASED_ORDER_STATUSES_SQL})`;
const USER_MATCH_SQL = "(user_id::text = $1 OR user_email = $1)";

const SECTION_ACCESSORIES = "accessories";
const SECTION_EXPERIENCE = "experience";

const COMPLEMENTARY_SECTION_LABELS = {
  [SECTION_ACCESSORIES]: "Phụ kiện nên mua kèm",
  [SECTION_EXPERIENCE]: "Thiết bị nâng cấp trải nghiệm",
  flashSales: "Đang có ưu đãi",
};

const CATEGORY_DEFINITIONS = [
  {
    slug: "dien-thoai",
    name: "Điện thoại",
    keywords: ["dienthoai", "smartphone"],
    fallbackAliases: ["phone", "iphone", "galaxy", "oppo", "xiaomi"],
  },
  {
    slug: "laptop",
    name: "Laptop",
    keywords: ["laptop", "notebook", "maytinhxachtay"],
    fallbackAliases: ["macbook", "thinkpad", "vivobook", "zenbook", "ideapad"],
  },
  {
    slug: "may-tinh-bang",
    name: "Máy tính bảng",
    keywords: ["maytinhbang", "tablet"],
    fallbackAliases: ["ipad", "galaxytab", "matepad"],
  },
  {
    slug: "tai-nghe",
    name: "Tai nghe",
    keywords: ["tainghe", "headphone", "earbuds"],
    fallbackAliases: ["airpods"],
  },
  {
    slug: "loa",
    name: "Loa",
    keywords: ["loa", "speaker"],
    fallbackAliases: [],
  },
  {
    slug: "ban-phim",
    name: "Bàn phím",
    keywords: ["banphim", "keyboard"],
    fallbackAliases: [],
  },
  {
    slug: "chuot",
    name: "Chuột",
    keywords: ["chuot", "mouse"],
    fallbackAliases: [],
  },
  {
    slug: "man-hinh",
    name: "Màn hình",
    keywords: ["manhinh", "monitor", "display"],
    fallbackAliases: [],
  },
];

const CATEGORY_BY_SLUG = new Map(
  CATEGORY_DEFINITIONS.map((category) => [category.slug, category]),
);

const COMPLEMENTARY_CATEGORY_MAP = {
  laptop: [
    { slug: "man-hinh", section: SECTION_EXPERIENCE },
    { slug: "chuot", section: SECTION_ACCESSORIES },
    { slug: "ban-phim", section: SECTION_ACCESSORIES },
    { slug: "tai-nghe", section: SECTION_ACCESSORIES },
  ],
  "dien-thoai": [
    { slug: "tai-nghe", section: SECTION_ACCESSORIES },
    { slug: "may-tinh-bang", section: SECTION_EXPERIENCE },
    { slug: "loa", section: SECTION_EXPERIENCE },
  ],
  "may-tinh-bang": [
    { slug: "ban-phim", section: SECTION_ACCESSORIES },
    { slug: "tai-nghe", section: SECTION_ACCESSORIES },
    { slug: "loa", section: SECTION_EXPERIENCE },
  ],
  "man-hinh": [
    { slug: "chuot", section: SECTION_ACCESSORIES },
    { slug: "ban-phim", section: SECTION_ACCESSORIES },
    { slug: "loa", section: SECTION_EXPERIENCE },
  ],
  "ban-phim": [
    { slug: "chuot", section: SECTION_ACCESSORIES },
    { slug: "man-hinh", section: SECTION_EXPERIENCE },
    { slug: "tai-nghe", section: SECTION_ACCESSORIES },
  ],
  chuot: [
    { slug: "ban-phim", section: SECTION_ACCESSORIES },
    { slug: "man-hinh", section: SECTION_EXPERIENCE },
    { slug: "tai-nghe", section: SECTION_ACCESSORIES },
  ],
  "tai-nghe": [
    { slug: "dien-thoai", section: SECTION_EXPERIENCE },
    { slug: "laptop", section: SECTION_EXPERIENCE },
    { slug: "loa", section: SECTION_EXPERIENCE },
  ],
  loa: [
    { slug: "tai-nghe", section: SECTION_ACCESSORIES },
    { slug: "dien-thoai", section: SECTION_EXPERIENCE },
    { slug: "laptop", section: SECTION_EXPERIENCE },
  ],
};

function normalizeLooseText(input = "") {
  return String(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function uniqueStrings(items = []) {
  return [...new Set(
    (Array.isArray(items) ? items : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
  )];
}

function findCategoryMatch(term = "", options = {}) {
  const normalized = normalizeLooseText(term);
  if (!normalized) return null;

  const includeFallbackAliases = options.includeFallbackAliases === true;
  return CATEGORY_DEFINITIONS.find((category) => {
    const categoryKeys = [
      category.slug,
      category.name,
      ...(category.keywords || []),
      ...(includeFallbackAliases ? category.fallbackAliases || [] : []),
    ].map((key) => normalizeLooseText(key));

    return categoryKeys.some(
      (key) => key && (normalized.includes(key) || key.includes(normalized)),
    );
  }) || null;
}

function cleanupComplementaryTerm(term = "") {
  return String(term || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'“”‘’,.:;!?()[\]-]+|[\s"'“”‘’,.:;!?()[\]-]+$/g, "")
    .replace(/^(khi|nếu|neu|sau khi|mình|minh|tôi|toi|em|khách|khach)\s+/i, "")
    .replace(/^(đã|da|vừa|vua)?\s*(mua|sắm|sam|có|co|xài|xai|dùng|dung)\s+/i, "")
    .replace(/\s+(rồi|roi|thì|thi)\b.*$/i, "")
    .replace(/\s+(nên|nen|cần|can)\s+(mua|sắm|sam)\b.*$/i, "")
    .replace(/\s+(mua|sắm|sam)\s+(gì|gi|món|mon|sp|sản phẩm|san pham)\b.*$/i, "")
    .replace(/\s+(tiếp|tiep|tiếp theo|tiep theo|kèm|kem|thêm|them|nữa|nua|phụ kiện|phu kien)\b.*$/i, "")
    .replace(/^(gợi ý|goi y|tư vấn|tu van)\s+/i, "")
    .trim();
}

function isUsefulComplementaryLookupTerm(term = "") {
  const normalized = normalizeLooseText(term);
  if (!normalized || normalized.length < 3) return false;

  const stopTerms = new Set([
    "toi",
    "minh",
    "em",
    "khach",
    "ban",
    "chotoi",
    "chominh",
    "choem",
    "mua",
    "sam",
    "goiy",
    "tuvan",
    "muatiep",
    "muakem",
    "muathem",
    "samtiep",
    "samkem",
    "samthem",
  ]);
  if (stopTerms.has(normalized)) return false;

  return !/^(goiy|tuvan)?(mua|sam)?(tiep|kem|them)(cho)?(toi|minh|em|khach)?$/.test(
    normalized,
  );
}

function extractComplementaryLookupTerms(prompt = "", entities = []) {
  const promptText = String(prompt || "").trim();
  const candidates = uniqueStrings(entities);
  const patterns = [
    /(?:đã|da|vừa|vua|khi|nếu|neu|sau khi)?\s*(?:mua|sắm|sam|có|co|xài|xai|dùng|dung)\s+(.+?)\s+(?:rồi|roi|thì|thi|nên|nen|cần|can|mua|sắm|sam|tiếp|tiep|kèm|kem|thêm|them)/i,
    /(?:gợi ý|goi y|tư vấn|tu van)\s+(?:mua\s+)?(?:tiếp|tiep|kèm|kem|thêm|them)\s+(?:cho\s+)?(.+?)$/i,
  ];

  for (const pattern of patterns) {
    const match = promptText.match(pattern);
    if (match?.[1]) candidates.push(match[1]);
  }

  candidates.push(promptText);
  return uniqueStrings(candidates.map((term) => cleanupComplementaryTerm(term)))
    .filter((term) => isUsefulComplementaryLookupTerm(term));
}

function buildTargetCategories(sourceSlugs = []) {
  const sourceSet = new Set(sourceSlugs.filter(Boolean));
  const seen = new Set();
  const targets = [];

  for (const sourceSlug of sourceSet) {
    for (const target of COMPLEMENTARY_CATEGORY_MAP[sourceSlug] || []) {
      if (!target?.slug || sourceSet.has(target.slug) || seen.has(target.slug)) {
        continue;
      }
      seen.add(target.slug);
      targets.push({
        ...target,
        name: CATEGORY_BY_SLUG.get(target.slug)?.name || target.slug,
      });
    }
  }

  return targets;
}

async function findBestMatchingProductContext(term, queryTimeoutMs = 6000) {
  const normalizedTerm = cleanupComplementaryTerm(term);
  if (!normalizedTerm || normalizeLooseText(normalizedTerm).length < 2) {
    return null;
  }

  const flexibleLike = `%${normalizedTerm.replace(/\s+/g, "%")}%`;
  const prefixLike = `${normalizedTerm.replace(/\s+/g, "%")}%`;
  const sql = `
    SELECT
      p.id,
      p.name,
      p.slug,
      p.min_price,
      p.total_stock,
      p.category_id,
      p.category_name,
      c.slug AS category_slug,
      p.brand_name,
      p.avg_rating,
      p.review_count,
      p.created_at
    FROM v_chatbot_products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'ACTIVE'
      AND (
        p.name ILIKE $1
        OR COALESCE(p.spec_summary, '') ILIKE $1
        OR COALESCE(p.description, '') ILIKE $1
      )
    ORDER BY
      CASE
        WHEN LOWER(p.name) = LOWER($2) THEN 0
        WHEN LOWER(p.name) LIKE LOWER($3) THEN 1
        ELSE 2
      END,
      p.review_count DESC NULLS LAST,
      p.avg_rating DESC NULLS LAST,
      p.total_stock DESC NULLS LAST,
      p.created_at DESC
    LIMIT 1
  `;

  const result = await runReadOnly(
    sql,
    [flexibleLike, normalizedTerm, prefixLike],
    queryTimeoutMs,
  );

  return result.rows?.[0] || null;
}

async function getRecentPurchaseSources(userId, queryTimeoutMs = 6000) {
  if (!userId) return [];

  const sql = `
    SELECT
      c.slug AS category_slug,
      e.category_name,
      (ARRAY_AGG(e.product_id ORDER BY e.ordered_at DESC))[1] AS id,
      (ARRAY_AGG(e.product_name ORDER BY e.ordered_at DESC))[1] AS name,
      MAX(e.ordered_at) AS last_ordered_at
    FROM v_chatbot_user_purchase_events e
    LEFT JOIN categories c ON c.id = e.category_id
    WHERE ${USER_MATCH_SQL}
      AND ${ORDER_PURCHASE_EVENT_SQL}
      AND c.slug IS NOT NULL
    GROUP BY c.slug, e.category_name
    ORDER BY MAX(e.ordered_at) DESC
    LIMIT 3
  `;

  const result = await runReadOnly(sql, [userId], queryTimeoutMs);
  return result.rows || [];
}

async function resolveComplementarySource({ prompt, entities, userId, queryTimeoutMs }) {
  const lookupTerms = extractComplementaryLookupTerms(prompt, entities);

  for (const term of lookupTerms) {
    const category = findCategoryMatch(term);
    if (category) {
      return {
        type: "category",
        categorySlug: category.slug,
        categoryName: category.name,
        sourceSlugs: [category.slug],
      };
    }
  }

  for (const term of lookupTerms) {
    const product = await findBestMatchingProductContext(term, queryTimeoutMs);
    if (product?.category_slug) {
      return {
        type: "product",
        product,
        productId: product.id,
        productName: product.name,
        categorySlug: product.category_slug,
        categoryName: product.category_name,
        sourceSlugs: [product.category_slug],
      };
    }
  }

  for (const term of lookupTerms) {
    const category = findCategoryMatch(term, { includeFallbackAliases: true });
    if (category) {
      return {
        type: "category",
        categorySlug: category.slug,
        categoryName: category.name,
        sourceSlugs: [category.slug],
      };
    }
  }

  const purchaseSources = await getRecentPurchaseSources(userId, queryTimeoutMs);
  const sourceSlugs = uniqueStrings(
    purchaseSources.map((source) => source.category_slug),
  );
  if (sourceSlugs.length) {
    return {
      type: "history",
      sources: purchaseSources,
      sourceSlugs,
      categoryName: purchaseSources
        .map((source) => source.category_name)
        .filter(Boolean)
        .slice(0, 3)
        .join(", "),
    };
  }

  return null;
}

async function queryComplementaryProducts({
  targetCategories,
  excludeProductId,
  userId,
  maxProducts,
  queryTimeoutMs,
}) {
  if (!targetCategories.length) return [];

  const targetSlugs = targetCategories.map((target) => target.slug);
  const sectionBySlug = new Map(
    targetCategories.map((target) => [target.slug, target.section]),
  );
  const limit = Math.max(maxProducts * 4, 12);
  const excludePurchasedSql = userId
    ? `
      AND p.id NOT IN (
        SELECT DISTINCT product_id
        FROM v_chatbot_user_purchase_events
        WHERE ${USER_MATCH_SQL.replace(/\$1/g, "$3")}
          AND ${ORDER_PURCHASE_EVENT_SQL}
      )
    `
    : "";
  const limitParam = userId ? "$4" : "$3";

  const sql = `
    SELECT
      p.id,
      p.name,
      p.min_price,
      p.total_stock,
      p.category_name,
      c.slug AS category_slug,
      p.brand_name,
      p.avg_rating,
      p.review_count,
      p.is_featured,
      p.created_at
    FROM v_chatbot_products p
    INNER JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'ACTIVE'
      AND c.slug = ANY($1::text[])
      AND ($2::uuid IS NULL OR p.id <> $2::uuid)
      ${excludePurchasedSql}
    ORDER BY
      CASE WHEN COALESCE(p.total_stock, 0) > 0 THEN 0 ELSE 1 END,
      p.is_featured DESC,
      COALESCE(p.avg_rating, 0) DESC,
      p.review_count DESC,
      p.created_at DESC
    LIMIT ${limitParam}
  `;

  const params = userId
    ? [targetSlugs, excludeProductId || null, userId, limit]
    : [targetSlugs, excludeProductId || null, limit];
  const result = await runReadOnly(
    sql,
    params,
    queryTimeoutMs,
  );

  return (result.rows || []).map((row) => ({
    ...row,
    recommendation_section:
      sectionBySlug.get(row.category_slug) || SECTION_EXPERIENCE,
  }));
}

async function queryComplementaryFlashSales({
  targetCategories,
  excludeProductId,
  userId,
  maxProducts,
  queryTimeoutMs,
}) {
  if (!targetCategories.length) return [];

  const targetSlugs = targetCategories.map((target) => target.slug);
  const excludePurchasedSql = userId
    ? `
      AND f.product_id NOT IN (
          SELECT DISTINCT product_id
          FROM v_chatbot_user_purchase_events
          WHERE ${USER_MATCH_SQL.replace(/\$1/g, "$3")}
          AND ${ORDER_PURCHASE_EVENT_SQL}
      )
    `
    : "";
  const limitParam = userId ? "$4" : "$3";
  const sql = `
    SELECT
      f.sale_name,
      f.end_time,
      f.product_name,
      f.display_name,
      f.attribute_summary,
      f.flash_price,
      f.flash_stock,
      f.sold_count,
      c.slug AS category_slug,
      p.category_name
    FROM v_chatbot_flash_sale_items f
    INNER JOIN v_chatbot_products p ON p.id = f.product_id
    INNER JOIN categories c ON c.id = p.category_id
    WHERE f.sale_status = 'ACTIVE'
      AND f.start_time <= NOW()
      AND f.end_time >= NOW()
      AND c.slug = ANY($1::text[])
      AND ($2::uuid IS NULL OR f.product_id <> $2::uuid)
      ${excludePurchasedSql}
    ORDER BY f.flash_price ASC
    LIMIT ${limitParam}
  `;

  const params = userId
    ? [targetSlugs, excludeProductId || null, userId, maxProducts]
    : [targetSlugs, excludeProductId || null, maxProducts];
  const result = await runReadOnly(
    sql,
    params,
    queryTimeoutMs,
  );

  return result.rows || [];
}

function groupComplementaryRows(rows = [], maxProducts = 5) {
  return {
    [SECTION_ACCESSORIES]: rows
      .filter((row) => row.recommendation_section === SECTION_ACCESSORIES)
      .slice(0, maxProducts),
    [SECTION_EXPERIENCE]: rows
      .filter((row) => row.recommendation_section === SECTION_EXPERIENCE)
      .slice(0, maxProducts),
  };
}

function hasComplementaryRows(result) {
  return Boolean(
    result?.[SECTION_ACCESSORIES]?.length ||
      result?.[SECTION_EXPERIENCE]?.length ||
      result?.flashSales?.length,
  );
}

/**
 * Gợi ý sản phẩm bổ trợ / mua tiếp:
 * - Guest: dựa vào product/category trong câu hỏi.
 * - User đăng nhập: ưu tiên câu hỏi; nếu hỏi chung thì dựa lịch sử mua gần đây.
 */
export async function getComplementaryRecommendations({
  userId = null,
  prompt = "",
  entities = [],
  maxProducts = 5,
  queryTimeoutMs = 6000,
} = {}) {
  let source = null;
  try {
    source = await resolveComplementarySource({
      prompt,
      entities,
      userId,
      queryTimeoutMs,
    });
  } catch (err) {
    console.warn("[RECOMMEND] Complementary source resolution failed:", err.message);
    const generic = await getRecommendations();
    return { ...generic, _complementary: false, _fallback: true };
  }

  if (!source?.sourceSlugs?.length) {
    const generic = await getRecommendations();
    return { ...generic, _complementary: false, _fallback: true };
  }

  const targetCategories = buildTargetCategories(source.sourceSlugs);
  if (!targetCategories.length) {
    const generic = await getRecommendations();
    return { ...generic, _complementary: false, _fallback: true };
  }

  try {
    const [products, flashSales] = await Promise.all([
      queryComplementaryProducts({
        targetCategories,
        excludeProductId: source.productId,
        userId,
        maxProducts,
        queryTimeoutMs,
      }),
      queryComplementaryFlashSales({
        targetCategories,
        excludeProductId: source.productId,
        userId,
        maxProducts,
        queryTimeoutMs,
      }),
    ]);

    const grouped = groupComplementaryRows(products, maxProducts);
    const result = {
      _complementary: true,
      _labels: COMPLEMENTARY_SECTION_LABELS,
      _source: source,
      _targetCategories: targetCategories,
      [SECTION_ACCESSORIES]: grouped[SECTION_ACCESSORIES],
      [SECTION_EXPERIENCE]: grouped[SECTION_EXPERIENCE],
      flashSales,
    };

    if (!hasComplementaryRows(result)) {
      const generic = await getRecommendations();
      return { ...generic, _complementary: false, _fallback: true };
    }

    return result;
  } catch (err) {
    console.warn("[RECOMMEND] Complementary recommendation failed:", err.message);
    const generic = await getRecommendations();
    return { ...generic, _complementary: false, _fallback: true };
  }
}

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
          AND start_time <= NOW()
          AND end_time >= NOW()
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
            WHERE ${USER_MATCH_SQL}
              AND ${PURCHASE_EVENT_SQL}
              AND category_id IS NOT NULL
          )
          AND p.id NOT IN (
            SELECT DISTINCT product_id
            FROM v_chatbot_user_purchase_events
            WHERE ${USER_MATCH_SQL}
              AND ${PURCHASE_EVENT_SQL}
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
            WHERE ${USER_MATCH_SQL}
              AND ${PURCHASE_EVENT_SQL}
              AND brand_id IS NOT NULL
          )
          AND p.id NOT IN (
            SELECT DISTINCT product_id
            FROM v_chatbot_user_purchase_events
            WHERE ${USER_MATCH_SQL}
              AND ${PURCHASE_EVENT_SQL}
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
          WHERE ${USER_MATCH_SQL}
            AND ${PURCHASE_EVENT_SQL}
        ),
        related_orders AS (
          SELECT DISTINCT order_id
          FROM v_chatbot_user_purchase_events
          WHERE ${PURCHASE_EVENT_SQL}
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
        WHERE (
            e.order_status IN (${PURCHASED_ORDER_STATUSES_SQL})
            OR e.payment_status IN (${PURCHASED_PAYMENT_STATUSES_SQL})
          )
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
          WHERE ${USER_MATCH_SQL}
            AND ${PURCHASE_EVENT_SQL}
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
            WHERE ${USER_MATCH_SQL}
              AND ${PURCHASE_EVENT_SQL}
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
         AND start_time <= NOW()
         AND end_time >= NOW()
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
