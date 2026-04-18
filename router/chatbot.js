import express from "express";
import { chatbot } from "../controller/chatbot.js";
import { optionalAuth } from "../middleware/optional-auth.js";

const router = express.Router();

router.post("/", optionalAuth, chatbot);

export default router;
