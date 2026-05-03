# Hozitech Chatbot

Service chatbot AI riêng cho Hozitech. Đây là backend độc lập với server Spring Boot, dùng Express + PostgreSQL + OpenAI/Gemini.

## Tổng Quan

- Chat public cho website Hozitech
- Tra cứu sản phẩm, flash sale, voucher public, đơn hàng khi đã đăng nhập
- Admin API để chỉnh cấu hình bot/widget/model
- Dùng read-model DB để trả lời nhanh và đúng dữ liệu

## Tech Stack

- Node.js
- Express
- PostgreSQL
- OpenAI API
- Google Gemini API
- JWT
- dotenv

## Cấu Trúc Chính

```
chatbot/
├── controller/   # logic chatbot/admin
├── router/       # routes
├── config/       # config, model catalog, defaults/settings
├── db/           # read-model init/executor
├── prompt/       # prompt templates
├── middleware/   # auth optional
└── index.js      # entrypoint
```

## Chạy Local

### Cài đặt

```bash
npm install
```

### Chạy service

```bash
npm run dev
```

Mặc định chạy ở `http://localhost:6969`

### Khởi tạo read-model DB

```bash
npm run db:init-read-models
```

## Biến Môi Trường

### Bắt buộc

- `OPENAI_API_KEY` hoặc `GEMINI_API_KEY`
- `JWT_SECRET_KEY`
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`

### Tùy chọn

- `PORT`
- `CORS_ORIGINS`
- `CHATBOT_AI_PROVIDER`
- `CHATBOT_AI_MODEL`
- `OPENAI_MODEL`
- `GEMINI_MODEL`
- `OPENAI_TIMEOUT_MS`
- `GEMINI_TIMEOUT_MS`
- `CHATBOT_ALLOWED_MODELS`
- `CHATBOT_DEBUG_RESPONSE`

### DB bootstrap / read-model init

- `CHATBOT_DB_BOOTSTRAP_URL`
- `DB_BOOTSTRAP_URL`
- `CHATBOT_DB_BOOTSTRAP_USER`
- `CHATBOT_DB_BOOTSTRAP_PASSWORD`
- `DB_URL`
- `DB_USERNAME`
- `DB_PASSWORD`

## API Chính

- `POST /api/v1/chatbot`
- `GET /api/v1/chatbot/admin/config`
- `PUT /api/v1/chatbot/admin/config`
- `POST /api/v1/chatbot/admin/config/reset`
- `GET /api/v1/chatbot/admin/config/defaults`
- `GET /api/v1/chatbot/admin/models`
- `GET /api/v1/chatbot/admin/widget-config`
- `GET /health`

## Ghi Chú

- Chatbot cho phép anonymous chat qua `optionalAuth`.
- Config runtime được merge từ `config/defaults.json` và `config/settings.json`.
- Nếu thiếu read-model views, hãy chạy `npm run db:init-read-models`.

