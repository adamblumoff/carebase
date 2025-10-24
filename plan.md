# Clerk Latency Remediation Plan

## Goal
Reduce perceived and measured latency during login flows and post-mutation refreshes by ensuring Bearer authentication no longer blocks on external Clerk calls for every request. Target <350 ms backend processing time for authenticated endpoints under normal network conditions.

---

## Phase 1 – Baseline & Safety Net
- [x] Record current timings (mobile dev build against local backend). Capture:
  - Cold login (app launch → plan visible)
  - Appointment PATCH round-trip
  - `/api/auth/session` latency from backend logs
- [x] Snapshot current metrics counters (`clerk.token.verify`, `auth.clerk.http`) for comparison. *(No flush logged; baseline noted as “no counters emitted” in docs/auth-latency.md.)*
- [x] Add temporary script (`scripts/dev/measure-auth-latency.ts`) if needed to re-run benchmarks quickly.

## Phase 2 – Restore Middleware Fast Path
- [x] Update `backend/src/server.ts` to enable Clerk Express handshake (`enableHandshake: true`) and adjust configuration for dev env if needed.
- [x] Enhance `attachBearerUser` to:
  - Trust populated `req.auth()` without invoking `verifyClerkSessionToken`.
  - Fall back only when handshake data is unavailable.
- [x] Add unit/integration coverage ensuring requests authenticated via middleware no longer call `verifyClerkSessionToken` (spy on helper in tests).
- [x] Re-run baseline scenarios to confirm immediate improvement; log results in a new `docs/auth-latency.md` section. *(Result: latency unchanged; handshake still returning `isAuthenticated: false`.)*

## Phase 3 – Token Verification Cache
- [x] Implement in-memory cache module (`backend/src/services/clerkTokenCache.ts`) storing `{sessionId, userId, expiresAt}` keyed by token (bounded size, 5 min max TTL, purge on expiry).
- [x] Update `verifyClerkSessionToken` to consult cache before performing JWKS/API calls; cache successful results and decoded fallbacks.
- [x] Instrument cache hits/misses (`clerk.token.cache|hit/miss`) and add focused unit tests covering expiry and error paths.

## Phase 4 – JWKS Prefetch & Resilience
- [x] Introduce startup prefetch of Clerk JWKS (await a single fetch during boot, with <1 s timeout) so the first authenticated request does not block.
- [x] Schedule periodic background refresh (e.g., every 15 min) with exponential backoff on failure.
- [x] Reduce JWKS HTTP timeout to 2 s and add retry once before falling back to cached keys; log metrics for reload failures.
- [x] Extend tests to simulate stale JWKS and ensure the system falls back gracefully without hanging the request.

## Phase 5 – Clerk REST Fallback Tuning
- [ ] Wrap `clerkClient.sessions.verifySession` call with a 2 s AbortController timeout.
- [ ] If timeout/error occurs, rely on decoded payload when signature already verified, and emit metric `clerk.token.verify|outcome=timeout`.
- [ ] Document behavior in `docs/auth.md` so operators know we may temporarily accept decoded claims under degraded Clerk conditions.

## Phase 6 – Remove Repeated Heavy Work
- [ ] Audit `ensureGoogleIntegrationSchema` to make sure it is only invoked once per process (confirm guard flags or introduce a global promise).
- [ ] Check other per-request guards (e.g., Google watch/channel checks) for redundant DB/crypto work; note findings.
- [ ] Add regression tests verifying schema bootstrap doesn’t rerun after first success.

## Phase 7 – Validation & Rollout
- [ ] Re-run baseline measurements from Phase 1; compare timings and metrics, target ≥60% drop in per-request auth overhead.
- [ ] Update `docs/auth-latency.md` with before/after numbers and lessons learned.
- [ ] Share findings in `AGENTS.md` (short summary + required env vars) for future agents.
- [ ] Leave follow-up TODOs (if any) in backlog and close plan.

## Guardrails
- Never disable Clerk verification entirely; all shortcuts must keep signature validation (JWT / cache) intact.
- Cache must respect token expiry and clear entries on sign-out or manual revoke.
- All changes require `npm run test:backend` and `npm run test --workspace=mobile` before commit.
