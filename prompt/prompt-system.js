import { getConfig } from "../config/config-manager.js";

const frontendRoutes = `
DANH SÁCH TRANG FRONTEND (dùng khi gợi ý link cho khách):
- Trang chủ: /
- Tìm kiếm sản phẩm: /search
- Danh sách sản phẩm: /products
- Chi tiết sản phẩm: /product/:id
- So sánh sản phẩm: /compare
- Yêu thích: /wishlist
- Flash Sale: /flash-sale
- Blog công nghệ: /blog
- Chi tiết bài viết: /blog/:id
- Giới thiệu: /about
- Điều khoản: /terms
- Chính sách bảo mật: /privacy
- Liên hệ: /contact
- Giỏ hàng: /cart
- Thanh toán: /checkout
- Đăng nhập: /login
- Đăng ký: /register
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

/**
 * Sinh system prompt **động** từ config (thay vì hard-code).
 * Mỗi lần gọi sẽ đọc config mới nhất từ cache.
 */
export function buildSystemPrompt() {
  const config = getConfig();
  const shop = config.shopInfo || {};
  const rules = config.ai?.systemRules || "";

  const intro =
    `Bạn là chatbot AI của ${shop.name || "Hozitech"} — ${shop.slogan || "Cửa hàng công nghệ"}. ` +
    `Địa chỉ: ${shop.address || "N/A"}. Hotline: ${shop.hotline || "N/A"}. ` +
    `Email hỗ trợ: ${shop.email || "N/A"}. Website: ${shop.website || "N/A"}. ` +
    `Thanh toán hỗ trợ: ${(shop.payments || []).join(", ")}.\n`;

  return intro + frontendRoutes + rules;
}

/* Backward-compatible default export  */
export default {
  get system() {
    return buildSystemPrompt();
  },
};
