# API

## Overview

The API is a Fastify server (`api/index.ts`) with:

- REST endpoints for health and Google OAuth/webhooks
- tRPC mounted at `/trpc` (HTTP + WebSocket for subscriptions)
- Drizzle ORM for Postgres

Run it locally with `pnpm api:dev`.

## Endpoints

- `GET /healthz`: health check
- `GET /auth/google/callback`: OAuth callback landing page (supports Expo/WebBrowser auth flows)
- `POST /webhooks/google/push`: receives:
  - **Pub/Sub push** for Gmail watch notifications (JWT-verified)
  - **Direct webhooks** for Calendar watch notifications (HMAC token in header)
- `GET /webhooks/google/push`: returns 200 (prevents noisy probes/404s)
- `POST /trpc/*` and `WS /trpc`: tRPC procedures + subscriptions

## Auth (tRPC)

- Incoming requests expect `Authorization: Bearer <Clerk JWT>`.
- The app requests tokens using `getToken({ template: 'trpc' })`, so you must configure that template in Clerk.

## Database

- Schema: `api/db/schema.ts`
- Migrations: `drizzle/migrations/`
- Commands:
  - `pnpm db:generate`
  - `pnpm db:migrate`
  - `pnpm db:push` (use carefully; prefer migrations)

### Ingestion debugging fields

Ingested tasks store extra context for diagnosis:

- `tasks.senderDomain`: parsed sender domain (best-effort).
- `tasks.ingestionDebug`: JSON blob containing model output, key header/category signals, and the final routing decision.

## Google ingestion (Gmail + Calendar)

### Source lifecycle

1. App gets an OAuth authorize URL via `trpc.sources.authorizeUrl`.
2. OAuth code exchange stores a refresh token server-side (`trpc.sources.connectGoogle` or the server-side callback path).
3. Watches are registered via `trpc.watch.register` (Gmail Pub/Sub watch + Calendar web hook watch).
4. Sync runs happen on:
   - Push: `/webhooks/google/push`
   - Manual: `trpc.ingestion.syncNow`
   - Fallback poll (server ticker)

### Required environment

See `.env.example` for the canonical list. Commonly required:

- OAuth: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- State/HMAC: `GOOGLE_STATE_SECRET` (required at server boot)
- Pub/Sub: `GOOGLE_PUBSUB_PROJECT`, `GOOGLE_PUBSUB_TOPIC_DEV` / `GOOGLE_PUBSUB_TOPIC_PROD`
- Calendar webhook address: `GOOGLE_WEBHOOK_URL` (or derived from `GOOGLE_REDIRECT_URI` in some cases)
- Vertex classification: `GOOGLE_VERTEX_PROJECT_ID`, `GOOGLE_VERTEX_LOCATION`

### Notes

- Gmail watch is Pub/Sub-backed. If watch registration fails with a permissions hint, grant Pub/Sub Publisher for `gmail-api-push@system.gserviceaccount.com` on the topic.
- Ingestion writes tasks idempotently per `(createdById, sourceId)` and will not resurrect tasks the caregiver explicitly ignored.
- Sender suppression: when a caregiver ignores tasks from the same sender domain repeatedly, the API auto-suppresses that domain and future messages are tombstoned (ignored) before classification.

## Sender suppressions (tRPC)

Manage suppressed sender domains (currently Gmail only):

- `trpc.senderSuppressions.list({ includeUnsuppressed?: boolean })`
- `trpc.senderSuppressions.suppress({ senderDomain })`
- `trpc.senderSuppressions.unsuppress({ id, resetCount?: boolean })`
- `trpc.senderSuppressions.remove({ id })`
- `trpc.senderSuppressions.stats()`

## Observability

- Server logs via pino (pretty logs in local TTY unless disabled).
- Optional PostHog server events via `POSTHOG_API_KEY` / `POSTHOG_HOST` (captures a basic `api_request` event on response).
