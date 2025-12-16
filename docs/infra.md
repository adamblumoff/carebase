# Infra & deployment

This doc describes how Carebase is hosted today:

- API: Railway
- Postgres: Railway
- Pub/Sub: GCP (separate dev/prod topics)

## Railway (API)

### Runtime

- Railway sets `PORT` in production; the API binds to `PORT` (falls back to `API_PORT` locally).
- The API exposes:
  - `GET /healthz`
  - `POST /webhooks/google/push` (Pub/Sub push + Calendar webhooks)
  - tRPC at `POST /trpc/*` and `WS /trpc`

### Environment variables

Use `.env.example` as the canonical list. In Railway, set the production equivalents, including:

- `DATABASE_URL` (Railway Postgres connection string)
- `GOOGLE_PUBSUB_PROJECT`
- `GOOGLE_PUBSUB_TOPIC_PROD`
- `GOOGLE_WEBHOOK_URL_PROD` (should be your Railway HTTPS URL + `/webhooks/google/push`)
- `GOOGLE_REDIRECT_URI_PROD` and `EXPO_PUBLIC_GOOGLE_REDIRECT_URI_PROD`
- `EXPO_PUBLIC_API_BASE_URL_PROD`
- `GOOGLE_STATE_SECRET` (required on boot)

## Railway (Postgres)

- The API connects via `DATABASE_URL`.
- Migrations are run via `pnpm db:migrate`.
- CI runs `pnpm db:migrate` only when `CI_DATABASE_URL` is configured (see `.github/workflows/ci.yml`).

## GCP Pub/Sub (Gmail watch)

### Topics

- Dev and prod use separate topics, configured via:
  - `GOOGLE_PUBSUB_TOPIC_DEV`
  - `GOOGLE_PUBSUB_TOPIC_PROD`

The API registers a Gmail watch pointing at the configured topic.

### Push subscription

Pub/Sub must push to the Railway API:

- Push endpoint: `https://<your-railway-host>/webhooks/google/push`
- Authentication: Pub/Sub push includes a JWT in `Authorization`; the API verifies it.

If watch registration fails with a permissions hint, ensure Pub/Sub allows Gmail push delivery:

- Grant Pub/Sub Publisher for `gmail-api-push@system.gserviceaccount.com` on the topic.

## Calendar webhooks (direct)

Calendar watches hit the same webhook path directly (not via Pub/Sub):

- Endpoint: `POST /webhooks/google/push`
- Auth: per-source HMAC token in the `x-goog-channel-token` header
- Address configuration:
  - Prod: set `GOOGLE_WEBHOOK_URL_PROD` to the Railway HTTPS URL + `/webhooks/google/push`
  - Dev: set `GOOGLE_WEBHOOK_URL` similarly (or rely on the redirect-URI-derived fallback)

