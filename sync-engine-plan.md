# Sync Engine Plan (Gmail + Calendar, push-first)

## Goals
- Near-real-time ingestion (seconds) from Gmail + Calendar into tasks.
- Minimal secrets; rely on existing GCP project and Railway deployment.
- Single Gmail account per user for now; design for future multi-account.
- Safe defaults: 1 req/sec/user, exponential backoff, 7-day log retention.

## High-level architecture
1) **Source onboarding** (already): OAuth, refresh token stored server-side.
2) **Watch registration** (new):
   - Gmail `users.watch` with history IDs; Calendar `events.watch` per primary calendar.
   - Pub/Sub topic delivers push notifications to Railway HTTPS endpoint.
   - Store `watchId`, `historyId`, `expiration` per source (plus calendar channel ID).
3) **Delta worker** (new):
   - On Pub/Sub message: verify JWT, look up source by `historyId` or `watchId`, run delta sync using `users.history.list` (Gmail) or `events.list` with `syncToken` (Calendar).
   - Upsert tasks; update cursors/historyId/syncToken.
4) **Renewal** (new):
   - Cron/loop to renew watches before expiry (~every 6 days) and to re-issue if expired.
5) **Fallback poll** (light):
   - If watch inactive or webhook unreachable, poll every 2–3 min with small max-results.
6) **UI signals**:
   - Live indicator per source: `active / degraded / disconnected` with last sync timestamp.
   - Banner when falling back to polling.
7) **Retention**:
   - Prune ingestion events/logs older than 7 days (scheduled job).

## Required setup
- GCP: existing project. Need Pub/Sub topic + push subscription pointing to Railway HTTPS endpoint.
- Railway: expose `/webhooks/google/push` over HTTPS.
- Env additions (minimal secrets):
  - `GOOGLE_PUBSUB_VERIFICATION_TOKEN` (random string) for push validation.
  - Reuse existing Google OAuth creds; no new service account JSON if possible (see validation below).

## Data model tweaks
- `sources` table:
  - Add `watchId`, `watchExpiration`, `historyId` (already), `calendarChannelId`, `calendarResourceId`, `calendarSyncToken`.
- `ingestion_events`:
  - Add `type` (gmail|calendar), `durationMs`.

## API/worker changes
1) **Watch registration endpoints**
   - `POST /internal/watch/register` (tRPC mutation) per source to set Gmail and Calendar watches; store identifiers and expiration.
2) **Webhook handler**
   - `POST /webhooks/google/push`
   - Validate: `X-Goog-Resource-State`, `X-Goog-Channel-Id`, `X-Goog-Resource-Id`, optional `X-Goog-Message-Number`; verify `GOOGLE_PUBSUB_VERIFICATION_TOKEN` (use as `token` when creating watch) and Pub/Sub JWT (if Pub/Sub push).
   - Enqueue delta sync for the matching source.
3) **Delta sync worker**
   - Gmail: `users.history.list` from stored `historyId`, then `messages.get` (metadata) for new IDs. Update `historyId`.
   - Calendar: `events.list` with `syncToken`; process changes; update `syncToken`.
   - Concurrency: limit to 5 fetches/user; rate limit 1 req/sec/user.
4) **Renewal job**
   - Runs hourly; renew when `watchExpiration` < 24h.
5) **Fallback poll**
   - If no active watch or last push >10 min, run a small poll (max 5 messages/events).
6) **UI**
   - Show status badge (Active/Degraded/Disconnected) and last sync time.
   - Banner when in fallback polling.

## Error handling & retries
- Exponential backoff with jitter on Gmail/Calendar errors.
- If `syncToken` invalid, fall back to full sync once and reset token.
- If watch returns 404/410, clear watch fields, trigger re-register.
- Log ingestion events with counts/durations; prune after 7 days.

## Open questions to finalize
- Pub/Sub vs direct push: Do we create a Pub/Sub topic now or start with direct HTTPS watch token validation (Gmail supports HTTP push without Pub/Sub but Pub/Sub is recommended)?
- Should we debounce rapid successive push notifications (e.g., coalesce within 2–3 seconds)?
- Any Railway-specific limits on background loops/cron we should account for?

