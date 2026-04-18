import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import "dotenv/config";
import chatbotRouter from "./router/chatbot.js";
import adminRouter from "./router/admin.js";
import { getConfig } from "./config/config-manager.js";

const app = express();
const port = process.env.PORT || 6969;

/*  CORS: chỉ cho phép origin cụ thể (không mở toang)  */
const ALLOWED_ORIGINS = (
  process.env.CORS_ORIGINS ||
  "http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // cho phép request không có origin (curl, Postman, server-to-server)
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: Origin ${origin} not allowed`));
      }
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Key"],
    exposedHeaders: ["Content-Disposition"],
    credentials: true,
    maxAge: 3600,
  }),
);

app.use(bodyParser.json({ limit: "30mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "30mb" }));

app.use("/api/v1/chatbot", chatbotRouter);
app.use("/api/v1/chatbot/admin", adminRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(port, () => {
  const shopName = getConfig()?.shopInfo?.name || "Chatbot";
  console.log(`🤖 ${shopName} Chatbot is running on port ${port}`);
  console.log(
    `📋 Admin API: http://localhost:${port}/api/v1/chatbot/admin/config`,
  );
  console.log(`🔒 CORS origins: ${ALLOWED_ORIGINS.join(", ")}`);
});
