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

### CareHub + Primary inbox rules

- Carebase operates around a single CareHub per caregiver (one care recipient + care team membership).
- For Gmail ingestion, the hub has a single **Primary** inbox (`sources.isPrimary=true` for provider `gmail`).
- Only the CareHub `owner` can create/set the Primary inbox.
  - `trpc.sources.connectGoogle` enforces this.
  - The server-side OAuth callback (`GET /auth/google/callback`) mirrors the same logic so viewers cannot accidentally create a second Primary.
- Ingestion/watch logic skips non-primary sources by default.

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

## Tasks (tRPC)

Key procedures used by the app:

- `trpc.tasks.listThin({ type?, reviewState? })`: main list feed for `/tasks` (All) and `/tasks/review` (Review).
  - If `reviewState` is omitted, the API excludes `ignored` tasks by default.
- `trpc.tasks.upcoming({ days })`: upcoming appointments + bills used by `/tasks/upcoming` (Upcoming).
  - Excludes `ignored` tasks and tasks with `status = done`.
- `trpc.tasks.stats({ upcomingDays })`: lightweight counts for the Tasks top nav (pending review + upcoming).
- `trpc.tasks.review({ id, action: "approve" | "ignore" })`:
  - `approve` sets `reviewState = approved`.
  - `ignore` sets `reviewState = ignored` and `status = done`, and increments sender suppression stats when applicable.
- `trpc.tasks.toggleStatus({ id })`: toggles `status` between `todo` and `done`.
- `trpc.tasks.updateDetails({ id, title?, description?, type? })`: used by the edit sheet.
- Task audit trail: core task mutations record rows in `task_events` (see `trpc.taskEvents.list` below).

Review/ignore semantics:

- `reviewState = pending` is the “needs review” queue.
- `reviewState = ignored` is a tombstone state; ignored tasks are excluded from default lists and do not resurrect on ingestion re-sync.
- Ignoring a Gmail-derived task may contribute to sender-domain suppression (after enough ignores, that domain is auto-suppressed and future messages are tombstoned earlier in ingestion).

## Observability

- Server logs via pino (pretty logs in local TTY unless disabled).
- Optional PostHog server events via `POSTHOG_API_KEY` / `POSTHOG_HOST` (captures a basic `api_request` event on response).

## CareHub (tRPC)

Core procedures:

- `trpc.careRecipients.my()`: current CareHub + membership.
- `trpc.careRecipients.create({ name, caregiverName? })`: create a CareHub (creates `owner` membership).
- `trpc.careRecipients.invite({ email? })`: owner-only; returns `{ token, expiresAt }`.
- `trpc.careRecipients.acceptInvite({ token, caregiverName? })`: join hub as `viewer`.
- `trpc.careRecipients.team()`: list care team members.
- `trpc.caregivers.me()`: current caregiver profile (name/email).
- `trpc.caregivers.setName({ name })`: update caregiver display name.
- `trpc.caregivers.setTimezone({ timezone })`: set caregiver IANA timezone (used for Today bucketing + notification schedules).

## Today (tRPC)

- `trpc.today.feed({ limit? })`: pre-aggregated Today feed sections + Daily note:
  - needs review, due today, upcoming (7 days), assigned to me, recently completed (24h)
  - also returns `hubLocalDate` / `hubTimezone` used for Daily note day boundaries

## Daily note (tRPC)

- `trpc.handoff.today()`: fetch the Daily note for the hub’s current local date.
- `trpc.handoff.upsertToday({ body })`: owner-only; upserts the Daily note for the hub’s current local date.

## Task history (tRPC)

- `trpc.taskEvents.list({ taskId, limit? })`: list task history entries, scoped to the caller’s CareHub.

## Push notifications (tRPC + background tick)

App → API:

- `trpc.pushTokens.register({ token, platform })`: register an Expo push token.
- `trpc.pushTokens.unregister({ token })`: disable a token.
- `trpc.pushTokens.active()`: list active tokens for the caregiver (useful for debugging).

Server sending:

- Assignment pushes are sent from `trpc.tasks.assign` (to the assignee).
- Daily digests are sent by a background ticker in `api/index.ts` (review digest + appointment today) and deduped via `notification_deliveries`.
