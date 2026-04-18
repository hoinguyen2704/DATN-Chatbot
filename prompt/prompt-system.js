import { getConfig } from "../config/config-manager.js";

const SHORT_FRONTEND_ROUTES = `
TRANG CHÍNH:
- Trang chủ: /
- Danh sách sản phẩm: /products
- Flash Sale: /flash-sale
- Blog: /blog
- Giỏ hàng: /cart
- Thanh toán: /checkout
- Đăng nhập: /login
- Đăng ký: /register
`;

const FULL_FRONTEND_ROUTES = `
DANH SÁCH TRANG FRONTEND ĐẦY ĐỦ:
- Tìm kiếm sản phẩm: /search
- Chi tiết sản phẩm: /product/:slug
- So sánh sản phẩm: /compare
- Yêu thích: /wishlist
- Chi tiết bài viết: /blog/:slug
- Giới thiệu: /about
- Điều khoản: /terms
- Chính sách bảo mật: /privacy
- Liên hệ: /contact
- Quên mật khẩu: /forgot-password
- Hồ sơ cá nhân: /user/profile
- Sổ địa chỉ: /user/address
- Phương thức thanh toán: /user/payment
- Lịch sử đơn hàng: /user/orders
- Theo dõi đơn hàng: /user/orders/:id
- Kho Voucher: /user/vouchers
- Đánh giá của tôi: /user/reviews
- Sản phẩm đã xem: /user/recently-viewed
- Thông báo: /user/notifications
- Cài đặt: /user/settings
- Hỗ trợ / Ticket: /user/support
`;

function normalizePrompt(input = "") {
  return String(input)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function shouldIncludeFullRouteCatalog(userPrompt = "") {
  const normalized = normalizePrompt(userPrompt);
  return /(link|duong dan|route|url|trang nao|vao dau|muc nao|dang nhap|dang ky|gio hang|thanh toan|don hang|voucher|ho tro|blog|chi tiet)/.test(
    normalized,
  );
}

/**
 * Sinh system prompt động từ config.
 */
export function buildSystemPrompt(userPrompt = "") {
  const config = getConfig();
  const shop = config.shopInfo || {};
  const rules = config.ai?.systemRules || "";
  const includeFullRoutes = shouldIncludeFullRouteCatalog(userPrompt);

  const intro =
    `Bạn là chatbot AI của ${shop.name || "Hozitech"} — ${shop.slogan || "Cửa hàng công nghệ"}. ` +
    `Địa chỉ: ${shop.address || "N/A"}. Hotline: ${shop.hotline || "N/A"}. ` +
    `Email hỗ trợ: ${shop.email || "N/A"}. Website: ${shop.website || "N/A"}. ` +
    `Thanh toán hỗ trợ: ${(shop.payments || []).join(", ")}.\n`;

  return [intro, SHORT_FRONTEND_ROUTES, includeFullRoutes ? FULL_FRONTEND_ROUTES : "", rules]
    .filter(Boolean)
    .join("\n");
}

/* Backward-compatible default export  */
export default {
  get system() {
    return buildSystemPrompt();
  },
};
