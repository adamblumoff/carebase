# Backend Clerk/Auth Test Coverage Plan

This plan targets the low-coverage Clerk- and auth-related services inside `backend/src/services`, with the goal of lifting each module to roughly 80% statements coverage while keeping integration behavior intact.

## Goals & Targets
- Raise coverage for `clerkAuthGateway.ts`, `clerkJwksManager.ts`, `clerkTokenCache.ts`, and supporting Clerk services (webhooks/sync) to ≥80% statements and ≥70% branches where practical.
- Preserve existing integration flows (notably `backend/src/routes/webhook.clerk.integration.test.ts`) and avoid breaking API contracts.
- Reuse existing test helpers when available; otherwise introduce focused test doubles.
- Capture regression-prone scenarios around caching, JWKS refreshes, and API fallbacks.

## Scope & Constraints
- In scope: modules under `backend/src/services` that handle Clerk auth/session logic and their immediate collaborators (metrics/logger stubs, token cache, JWKS manager).
- Out of scope for this phase: database query coverage, non-Clerk services, mobile application.
- Tests run with Vitest (`npm run test:backend`). Maintain Node test runner compatibility; avoid hitting the real Clerk network.

## Phase 1 — Recon & Baseline
1. Inspect current Vitest suites in `backend/src/services/__tests__` and any shared mocks (search for `clerk` helpers, verify if `resetClerkJwksForTests` and cache resets are already used).
2. Review `backend/src/routes/webhook.clerk.integration.test.ts` to understand integration expectations and confirm no external dependencies need stubbing adjustments.
3. Run `npm run test:backend -- --coverage --runTestsByPath backend/src/services` to capture the exact baseline numbers for targeted files.

## Phase 2 — Clerk Token Cache Tests
1. Expand `clerkTokenCache` tests to cover:
   - Expiration logic with `CLOCK_SKEW_MS` (entries expiring slightly before actual expiration).
   - LRU eviction when `MAX_CACHE_SIZE` is exceeded (mock `process.env.CLERK_TOKEN_CACHE_SIZE`).
   - Handling of immediate-expiry writes (ensure entry not stored when `expiresAt` <= now + skew).
   - Stats reporting after cache mutations.
2. Leverage `vi.useFakeTimers()` to control `Date.now()` and restore after each test.
3. Ensure `__resetClerkTokenCacheForTests()` is used in `beforeEach` to keep tests isolated.

## Phase 3 — Clerk JWKS Manager Tests
1. Build out tests exercising:
   - Initial fetch success path using mocked `fetch` returning valid JWKS.
   - Retry + failure handling (simulate non-OK response, timeout, malformed payload), verifying metrics and error propagation.
   - Backoff scheduling after refresh failures and reset via `resetClerkJwksForTests()`.
   - Prefetch flow (`configureClerkJwks` with issuer) and custom refresh intervals.
2. Mock timers to assert `setTimeout` scheduling without waiting for real time.
3. Validate that multiple concurrent calls share the same inflight loader promise and reuse cached verifier.

## Phase 4 — Clerk Auth Gateway Tests
1. Add a dedicated test suite for `clerkAuthGateway` focusing on:
   - `getClerkClient()` returning `null` without `CLERK_SECRET_KEY` and caching the warning; verify logging behavior with spies.
   - Client caching when the secret is present; ensure subsequent calls reuse the same instance and respect custom API config.
   - Token verification cache hits vs misses (mock `getClerkTokenCacheEntry`, `setClerkTokenCacheEntry`, `incrementMetric`).
   - JWT decode failures triggering metric increments and null result.
   - Missing session ID/issuer leading to `missing_sid` metric outcome.
   - Successful JWKS verification path (mock `getClerkJwksVerifier`, `jwtVerify`) and cache population.
   - JWKS failure cascading to Clerk API verification (stub `clerkClient.sessions.verifySession`) including timeout handling and metric tagging.
   - Ensuring cache is cleared on JWKS failure (`deleteClerkTokenCacheEntry`).
2. Use `vi.mock` to replace external modules (`@clerk/backend`, `jsonwebtoken`, `jose`, local cache modules) with controllable fakes; reset modules between tests to avoid shared state.
3. Export or otherwise access a test-only reset helper for `cachedClient`/`warnedMissingSecret` (e.g., conditionally export `__resetClerkAuthGatewayForTests()`), or leverage `vi.resetModules()` + dynamic import—decide after brief spike during implementation.

## Phase 5 — Supporting Clerk Services (Optional Stretch)
1. Evaluate coverage gaps for `clerkWebhookService.ts`, `clerkSyncService.ts`, and `clerkRestClient.ts` to determine if small tests can push them over 80% with minimal effort.
2. Prioritize scenarios that guard against regressions: webhook signature validation, sync retry logic, and REST client error wrapping.
3. Only implement if coverage targets for core modules (Phases 2–4) fall short of 80%.

## Phase 6 — Verification & Reporting
1. Re-run `npm run test:backend -- --coverage --runTestsByPath backend/src/services` to confirm coverage gains; capture report sections for Clerk modules.
2. Run the full backend suite (`npm run test:backend`) to ensure no regressions elsewhere.
3. Document notable test helpers or patterns (e.g., timer mocking, module resets) in a short README checklist or inline comments for future contributors if new utilities were added.
4. Provide the user a concise summary of coverage improvements and any remaining edge cases deferred to later phases.

## Self-Check
- Focuses on Clerk/auth services as requested; other areas deferred.
- Each phase includes concrete tasks, dependencies, and validation steps.
- Plan preserves integration realism by auditing existing integration tests and stubbing external calls, aligning with user preferences.
- Coverage verification and documentation wrap-up ensure measurable results and maintainability.
