# AI Chatbot (Koyeb + Supabase + Gemini)

A Koyeb-ready AI chatbot app with:
- Username/password sign-up and login.
- UUID for every user.
- Supabase-backed users, chats, messages, and banners.
- Markdown + emoji support in user and bot messages.
- Per-user bot personality control.
- Admin capabilities: global banner, user/chat/message security overview.

## 1) Setup Supabase

1. Create a Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. Copy project URL and service role key.

## 2) Configure environment

Copy `.env.example` to `.env` and fill values:

```bash
cp .env.example .env
```

Important:
- `ADMIN_USER_ID` should be the UUID you want to have admin powers.
- New sign-ups become admin only if their generated UUID equals `ADMIN_USER_ID`.
- If you need to force admin after sign-up, set `is_admin=true` for that user in Supabase.

## 3) Local run

```bash
npm install
npm start
```

Open `http://localhost:3000`.

If env vars are missing, the server now stays up in **setup-only mode** (so previews don't show a dead app). In that mode, `/api/health` returns which variables are missing and other API routes return `503` until configured.

## 4) Deploy on Koyeb

1. Push this repo to GitHub.
2. In Koyeb: Create App → GitHub repo.
3. Use Dockerfile deploy.
4. Set env vars from `.env.example`.
5. Deploy.

## Notes

- Messages are rendered as markdown in the browser.
- Emojis work in plain text and markdown content.
- Admin can view messages/chats in the Admin panel for moderation/security.
