import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import "dotenv/config";
import chatbotRouter from "./router/chatbot.js";
import adminRouter from "./router/admin.js";
import { getConfig } from "./config/config-manager.js";

const app = express();
const port = process.env.PORT || 6969;

app.use(bodyParser.json({ limit: "30mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "30mb" }));
app.use(cors());

app.use("/api/v1/chatbot", chatbotRouter);
app.use("/api/v1/chatbot/admin", adminRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(port, () => {
  const shopName = getConfig()?.shopInfo?.name || "Chatbot";
  console.log(`🤖 ${shopName} Chatbot is running on port ${port}`);
  console.log(`📋 Admin API: http://localhost:${port}/api/v1/chatbot/admin/config`);
});
