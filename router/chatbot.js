import express from "express";
import { chatbot } from "../controller/chatbot.js";

const router = express.Router();

router.post("/", chatbot);

export default router;
