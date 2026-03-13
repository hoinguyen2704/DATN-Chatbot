import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import "dotenv/config";
import chatbotRouter from "./router/chatbot.js";

const app = express();
const port = process.env.PORT || 6969;

app.use(bodyParser.json({ limit: "30mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "30mb" }));
app.use(cors());

app.use("/api/v1/chatbot", chatbotRouter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.listen(port, () => {
  console.log(`🤖 Hozitech Chatbot is running on port ${port}`);
});
