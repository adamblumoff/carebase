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
  - `AuthGate` to keep unauth users in `app/(auth)` (implemented in `components/gates.tsx`)
  - `SetupGate` to route signed-in users without a CareHub to `/setup` (implemented in `components/gates.tsx`)
  - Device registration: timezone sync + Expo push token registration (`components/DeviceRegistration.tsx`)
  - Subscription toast: `ingestionEvents.onPush` triggers a background invalidate (`listThin`, `upcoming`, `stats`) + “New task synced” toast

## Today UI (routing)

- Bottom tab default: `/` (route: `app/(tabs)/index.tsx`) is the **Today** screen.
- Today pulls a pre-aggregated feed via `trpc.today.feed`:
  - Needs review
  - Due today
  - Upcoming (7 days)
  - Assigned to me
  - Recently completed (24h)
- Today includes a pinned **Daily note** (shared note for the care team) and uses the CareHub timezone for day boundaries.

## Tasks UI (routing)

- Bottom tab entry: `/tasks` (route: `app/(tabs)/tasks/index.tsx`).
- Subtabs within Tasks:
  - `/tasks` (All)
  - `/tasks/upcoming` (Upcoming)
  - `/tasks/review` (Review)
- `Review` and `Upcoming` are hidden from the bottom tab bar (they remain routable for deep links).
- Review actions (`approve`/`ignore`) are optimistic client-side; the app updates cached lists immediately and commits to the database in the background.

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
  - includes `caregivers.timezone` (IANA string, set from the app)
- `care_recipient_memberships`: links caregivers to exactly one CareHub (role is `owner` or `viewer`).
- `sources`: connected provider accounts (currently `gmail`), refresh tokens, watch metadata, status.
- `tasks`: primary UI entity; both manual tasks and ingested tasks live here (ingested tasks also carry `senderDomain` + `ingestionDebug` for diagnosis).
- `handoff_notes`: daily note keyed by `(careRecipientId, localDate)` using the CareHub timezone.
- `task_events`: audit trail of task changes (what changed, by who).
- `ingestion_events`: small log of sync runs and counts (drives “recent ingestion” UI and push events).
- `sender_suppressions`: per-caregiver sender-domain suppression (used to auto-ignore repeat junk sources before model classification).
- `push_tokens`: Expo push tokens registered by caregivers (used for OS push notifications).
- `notification_deliveries`: de-dupe log for digests (prevents repeat sends).

## CareHub model (collaboration)

- A CareHub is one care recipient + a care team (caregivers).
- Roles:
  - `owner`: can invite caregivers and manage the hub’s Primary inbox.
  - `viewer`: read-only for hub configuration (can still connect their own inbox, but it will not become Primary).
- Invitation flow: the owner generates an invite code in Profile → CareHub; other caregivers join via Setup.
