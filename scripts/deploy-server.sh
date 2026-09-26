#!/usr/bin/env sh
set -eu

DEPLOY_REF="${DEPLOY_REF:-origin/main}"
PUBLIC_WEB_URL="${PUBLIC_WEB_URL:-}"
REGISTER_MAX_WEBHOOK="${REGISTER_MAX_WEBHOOK:-0}"

if [ ! -f secrets/max_bot_token ]; then
  echo "Missing secrets/max_bot_token" >&2
  exit 1
fi

if [ ! -f secrets/max_webhook_secret ]; then
  echo "Missing secrets/max_webhook_secret" >&2
  exit 1
fi

if [ ! -f secrets/russian_trusted_root_ca ]; then
  echo "Missing secrets/russian_trusted_root_ca" >&2
  exit 1
fi

git fetch --prune origin
git reset --hard "$DEPLOY_REF"
export COMMIT_SHA="$(git rev-parse --short HEAD)"

docker compose up -d --build
docker compose ps

docker run --rm --network host -v "$PWD:/app:ro" -w /app -e SMOKE_API_URL=http://127.0.0.1:3001 node:20-alpine node scripts/smoke.mjs

if [ "$REGISTER_MAX_WEBHOOK" = "1" ]; then
  if [ -z "$PUBLIC_WEB_URL" ]; then
    echo "PUBLIC_WEB_URL is required when REGISTER_MAX_WEBHOOK=1" >&2
    exit 1
  fi

  token="$(cat secrets/max_bot_token)"
  secret="$(cat secrets/max_webhook_secret)"
  webhook_url="${PUBLIC_WEB_URL%/}/webhook"
  body="$(printf '{"url":"%s","update_types":["message_created","bot_started"],"secret":"%s"}' "$webhook_url" "$secret")"
  response="$(curl -fsS -X POST 'https://platform-api2.max.ru/subscriptions' -H "Authorization: $token" -H 'Content-Type: application/json' -d "$body")"
  printf '%s\n' "$response" | grep -q '"success"[[:space:]]*:[[:space:]]*true'
  echo "MAX webhook registered: $webhook_url"
fi

echo "Deploy complete"
