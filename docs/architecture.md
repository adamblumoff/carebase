# Architecture

## High-level

- **App**: Expo SDK 54 + Expo Router routes in `app/`, shared UI in `components/`, Tailwind via NativeWind with global tokens in `global.css`.
- **API**: Fastify server in `api/index.ts` with tRPC mounted at `/trpc` (HTTP + WebSocket for subscriptions).
- **Database**: Postgres via Drizzle ORM (`api/db/schema.ts`) with SQL migrations in `drizzle/migrations/`.
- **Ingestion**: Gmail + Calendar read-only sync into `tasks`, with push-first watches and a fallback poll.

## App layout (runtime)

- `app/_layout.tsx` sets up:
  - `ClerkProvider` for auth
  - `PostHogProvider` when `EXPO_PUBLIC_POSTHOG_KEY` is set
  - TanStack Query persistence to AsyncStorage + tRPC provider (`lib/trpc/client.ts`)
  - `AuthGate` to keep unauth users in `app/(auth)`
  - Task prefetch on sign-in (`tasks.list` and common filters) + recent ingestion events
  - Subscription toast: `ingestionEvents.onPush` triggers a background invalidate + “New task synced” toast

## Data flow

- **Client → API**: tRPC over HTTP batch link; subscriptions use WebSocket when available.
- **Auth**: App sends `Authorization: Bearer <token>` from Clerk (`getToken({ template: 'trpc' })`).
- **Caching**: Queries are cached and persisted; cache is cleared when the signed-in `userId` changes to avoid cross-account leakage.

## Backend ingestion flow (push-first)

- A connected Google account is stored as a `sources` row (refresh token server-side).
- Watch registration stores Gmail watch + Calendar watch metadata in `sources`:
  - Gmail watch is Pub/Sub-backed.
  - Calendar watch hits the app’s webhook URL directly and uses a per-source HMAC token.
- Push webhook (`POST /webhooks/google/push`) triggers a debounced sync run and updates `sources.lastPushAt`.
- Sync results are recorded in `ingestion_events`. When changes occurred, a push event is emitted to subscribed clients (`ingestionEvents.onPush`).
- Background tickers:
  - Watch renewal runs hourly.
  - Fallback poll runs periodically for stale/expired sources.

## Core tables (current)

- `caregivers`: app user record (maps to Clerk user via email).
- `sources`: connected provider accounts (currently `gmail`), refresh tokens, watch metadata, status.
- `tasks`: primary UI entity; both manual tasks and ingested tasks live here (ingested tasks also carry `senderDomain` + `ingestionDebug` for diagnosis).
- `ingestion_events`: small log of sync runs and counts (drives “recent ingestion” UI and push events).
- `sender_suppressions`: per-caregiver sender-domain suppression (used to auto-ignore repeat junk sources before model classification).
