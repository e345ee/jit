# MAX integration

## What is already implemented

- `apps/bot` exposes `GET /health`, `GET /me` and `POST /webhook`.
- The bot reads `MAX_BOT_TOKEN` from local `.env` or `MAX_BOT_TOKEN_FILE` in Docker.
- The webhook checks `X-Max-Bot-Api-Secret` when `MAX_WEBHOOK_SECRET` is configured.
- `/start`, `старт` and `bot_started` send a short safety message and an inline keyboard with native mini app opening.
- Free text messages search the same content API as the mini app and return a short route directly in the bot.
- The mini app URL is taken from `MINI_APP_PUBLIC_URL`.
- Native MAX opening uses `open_app`; `MAX_MINI_APP_WEB_APP` can explicitly point to the bot public name or MAX bot link when MAX requires it.
- Production web builds require signed MAX `initData`; direct browser opening shows an "open through MAX" screen.
- The content API URL for bot answers is taken from `CONTENT_API_URL`, then `API_PUBLIC_URL`, then local fallback.

## Local checklist

1. Keep real values only in `.env` and `secrets/`.
2. Start local services:

```bash
docker compose up --build
```

3. Expose `web` and `bot` through HTTPS.
4. Set:

```bash
MINI_APP_PUBLIC_URL=https://<public-web-host>
MAX_MINI_APP_WEB_APP=<bot-public-name-or-max-link>
API_PUBLIC_URL=https://<public-api-host>
MAX_WEBHOOK_SECRET=<random-secret>
VITE_REQUIRE_MAX_LAUNCH=true
```

5. Register the webhook in MAX for the existing bot token.

## Webhook subscription

Use the existing bot token. Do not create a new bot for the submitted project.

Expected production shape:

- API host: `https://platform-api2.max.ru`
- update types: `message_created`, `bot_started`
- webhook URL: `https://<public-bot-host>/webhook`
- secret header expected by our bot: `X-Max-Bot-Api-Secret`

The public bot URL must use HTTPS. MAX expects a fast response from the webhook, so slow work should go to a worker.

## Mini app button

The current adapter sends one button:

- `open_app` with optional `web_app = MAX_MINI_APP_WEB_APP` and payload `chat_<id>` or `user_<id>`.

The mini app loads MAX Bridge, sends `window.WebApp.initData` to `POST /max/session`, and the API validates the HMAC signature with `MAX_BOT_TOKEN`. After validation, start parameters are normalized to `chat:<id>` or `user:<id>` so neutral reminders keep the correct MAX target. URL query `maxTarget` is kept only for local diagnostics and old direct links.

## Final demo checklist

- Run `GET /me` against the real token without printing the token.
- Configure the webhook subscription with the secret.
- Open MAX, send `/start`, click the mini app button, and record the working path for the presentation.
