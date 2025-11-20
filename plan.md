# Plan: Carebase Hardening & Simplification (Q4 2025)

## Objectives
- Reduce security and operational risk (webhooks, device storage, background jobs).
- Simplify hotspots (Plan screen, medication service) without a rewrite.
- Establish one path for schema management and observability.

## Guiding Principles
- Prefer incremental, test-backed changes; keep shared types/contracts as source of truth.
- One API/service per concern; small React components/hooks over monolith screens.
- Secure by default: shrink blast radius before adding features.

## Phase 0 — Quick Wins (Week 1)
- **Mobile data-at-rest**: Move plan cache from AsyncStorage to `expo-secure-store` (fallback to encrypted blob if unsupported). Path: `mobile/src/plan/PlanProvider.tsx`.
- **Google webhook verification**: Require `x-goog-channel-token` match; reject missing/invalid tokens. Path: `backend/src/services/googleSync/watchers.ts`.
- **Job singleton**: Gate `startMedicationOccurrenceResetJob` and `startGoogleSyncPolling` behind `WORKER_ENABLED=true` (or `ROLE=worker`). Path: `backend/src/server.ts`.
- **Rate-limit map pruning**: Add TTL cleanup to `rateLimitBuckets` to avoid unbounded growth. Path: `backend/src/routes/webhook.ts`.
- **CORS/helmet**: Add minimal hardening: origin allowlist for API/Socket.IO, Helmet defaults. Path: `backend/src/server.ts`.

## Phase 1 — Schema & Data Hygiene (Week 2)
- Pick a single schema source: keep `backend/src/db/schema.sql` + migrations; remove runtime `ensure*Schema` once migrations cover collaborators/Google tables.
- Add migration to enforce webhook watch tokens (NOT NULL where expected) and sensible defaults.
- Backfill indexes for medication intakes/occurrences if missing in prod.

## Phase 2 — Service Decomposition (Week 3–4)
- **Medication service split**: Extract occurrence reconciliation, reminder scheduling hooks, and intake mutations into separate modules with narrow interfaces. Add unit tests around conflict handling.
- **Storage service**: Wrap `storeText/retrieveText` with size limits and MIME metadata; consider S3 adapter hook for production.
- **Google sync**: Move watch management, token refresh, and delta scheduling into dedicated files with clear telemetry.

## Phase 3 — Mobile UX & State (Week 3–4, parallel)
- Break `PlanScreen` into:
  - `PlanSummary` (appointments/bills),
  - `ReviewModal`,
  - `MedicationPanel` (list),
  - `MedicationDetailSheet` stays but delegates occurrence controls to a new `MedicationOccurrenceList`.
- Strengthen `useMedications`: memoized selectors, optimistic state helpers, and a tiny reducer to keep local/remote state aligned.
- Add lightweight vitest/RTL coverage for the split components, keeping screens smoke-tested only.

## Phase 4 — Observability & Ops (Week 5)
- Centralize metrics/logging (pino) with request IDs; emit job start/end + error metrics for Google sync and medication reset.
- Add health checks: `/health` already exists—extend with DB + queue (job) status stubs.
- Ship a runbook in `docs/operations.md` covering: rotating webhook tokens, clearing Clerk token cache, and checking reminder queues.

## Phase 5 — ORM Pilot (Optional, Week 5–6)
- Pilot Drizzle (pg) on a bounded context (collaborators/recipients). Use existing Pool. Keep raw SQL for medication/google until confidence gained.
- Generate types from `schema.sql`; ensure contract tests stay green. Abort if query plans regress.

## Phase 6 — Testing & CI (Ongoing)
- Expand contract tests to assert webhook token enforcement and new auth/cors headers.
- Add unit tests for rate-limit TTL and job singleton guard.
- Run full matrix: `npm run test:backend`, `npm run test --workspace=mobile`, `npm run test:contracts`, `npm run coverage`.

## Exit Criteria
- Sensitive payloads encrypted at rest on device; webhook endpoints require tokens.
- Background jobs run once per deployment, observable via metrics/logs.
- Plan screen and medication flows modular, tested, and easier to reason about.
- Single schema path with migrations; optional ORM pilot validated or rolled back.
