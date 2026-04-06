import express from "express";
import crypto from "crypto";
import {
  getAdminConfig,
  updateAdminConfig,
  resetAdminConfig,
  getAdminDefaults,
  getWidgetConfig,
} from "../controller/admin.js";

const router = express.Router();

const JWT_ALG_TO_HASH = {
  HS256: "sha256",
  HS384: "sha384",
  HS512: "sha512",
};

function base64UrlToBuffer(input) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function parseJsonBase64Url(part) {
  return JSON.parse(base64UrlToBuffer(part).toString("utf8"));
}

function verifyJwt(token, secret) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid token format");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = parseJsonBase64Url(encodedHeader);
  const payload = parseJsonBase64Url(encodedPayload);

  const hashAlg = JWT_ALG_TO_HASH[header.alg];
  if (!hashAlg) {
    throw new Error("Unsupported token algorithm");
  }

  const data = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto
    .createHmac(hashAlg, Buffer.from(secret, "utf8"))
    .update(data)
    .digest("base64url");

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const providedBuffer = Buffer.from(encodedSignature, "utf8");

  if (
    expectedBuffer.length !== providedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  ) {
    throw new Error("Invalid token signature");
  }

  if (payload.exp && Date.now() >= payload.exp * 1000) {
    throw new Error("Token expired");
  }

  return payload;
}

function isAdminPayload(payload) {
  const role = payload?.role;
  if (typeof role === "string" && role.toUpperCase() === "ADMIN") {
    return true;
  }

  const roles = payload?.roles;
  if (Array.isArray(roles)) {
    return roles.some((r) => String(r).toUpperCase().includes("ADMIN"));
  }

  return false;
}

/*  Auth middleware: kiểm tra Bearer JWT (ADMIN)  */
function adminAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const jwtSecret = process.env.JWT_SECRET_KEY;
  if (!jwtSecret) {
    console.error("[ADMIN] JWT_SECRET_KEY is missing. Admin API is disabled.");
    return res.status(503).json({ error: "Admin API is not configured" });
  }

  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    try {
      const payload = verifyJwt(token, jwtSecret);
      if (!isAdminPayload(payload)) {
        return res
          .status(403)
          .json({ error: "Forbidden — Admin role required" });
      }
      return next();
    } catch (e) {
      return res.status(401).json({ error: `Unauthorized — ${e.message}` });
    }
  }

  return res.status(401).json({ error: "Unauthorized — Missing Bearer token" });
}

/*  Admin routes (protected)  */
router.get("/config", adminAuth, getAdminConfig);
router.put("/config", adminAuth, updateAdminConfig);
router.post("/config/reset", adminAuth, resetAdminConfig);
router.get("/config/defaults", adminAuth, getAdminDefaults);

/*  Widget config (public — no auth)  */
router.get("/widget-config", getWidgetConfig);

export default router;
