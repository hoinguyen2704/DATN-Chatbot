import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET_KEY;

/**
 * Middleware: Tùy chọn xác thực JWT.
 * - Nếu có token hợp lệ → gán req.userId
 * - Nếu không có token hoặc token hết hạn → req.userId = null (anonymous)
 * - KHÔNG bao giờ trả 401 — chatbot luôn hoạt động cho cả anonymous
 */
export function optionalAuth(req, _res, next) {
  req.userId = null;

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.slice(7);
  if (!token || !JWT_SECRET) {
    return next();
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Spring Boot JWT thường dùng "sub" hoặc "userId" claim
    req.userId = decoded.userId || decoded.sub || null;
    if (req.userId) {
      console.log(`[AUTH] Identified user: ${req.userId}`);
    }
  } catch (err) {
    // Token hết hạn hoặc sai → vẫn cho chat, coi như anonymous
    console.log(`[AUTH] Token invalid/expired, continuing as anonymous`);
  }

  next();
}
