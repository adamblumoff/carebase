# Backend Test Inventory (Vitest Migration Phase 1)

This inventory captures every backend test suite currently running under the Node/tsx runner or other harnesses, and highlights their key dependencies. It serves as the checklist for the upcoming Vitest migrations.

## Existing Node Runner Suites (`node:test` + `assert`)

| File | Category | Notable Dependencies |
| --- | --- | --- |
| `backend/src/controllers/api/plan.test.ts` | Controller unit test | `node:test` mocks, direct `db/queries` import |
| `backend/src/controllers/api/upload.test.ts` | Controller unit test | File mocking, `node:test` |
| `backend/src/routes/webhook.integration.test.ts` | Route integration | Express app bootstrapping, `supertest`, pg fixtures |
| `backend/src/routes/webhook.clerk.integration.test.ts` | Route integration | Express, Clerk webhook fixtures |
| `backend/src/routes/api/collaborators.test.ts` | Route integration | Express, `supertest`, pg-mem |
| `backend/src/routes/api/collaborators.accept.integration.test.ts` | Route integration | Express, `supertest`, pg-mem, schema bootstrap |
| `backend/src/routes/api/integrations/google.test.ts` | Route integration | Express, Google mocks, `supertest` |
| `backend/src/services/googleSync.dispatcher.test.ts` | Service unit/integration | pg-mem, scheduler stubs |
| `backend/src/services/googleSync.integration.test.ts` | Service integration | Full google sync pipeline, pg-mem |
| `backend/src/services/googleSync.legacyFallback.test.ts` | Service regression | Google sync fallback logic |
| `backend/src/services/googleManagedCalendar.test.ts` | Service unit | Google calendar helpers |
| `backend/src/services/parser.test.ts` | Parser unit | Fixture-heavy text parsing |
| `backend/src/services/planRealtimePublisher.test.ts` | Realtime service | Event emitter stubs |

Shared helper detected: `backend/src/services/googleSync.testUtils.ts` (utilities to stand up pg-mem + Google mocks for the `node:test` suites).

## Existing Vitest Suites (Already Migrated)

These already run under Vitest and establish expectations for configuration: timers, fetch mocks, etc.

| File | Notes |
| --- | --- |
| `backend/src/services/__tests__/*.vitest.test.ts` | Service unit tests for Clerk, Google sync helpers |
| `backend/src/utils/__tests__/*.vitest.test.ts` | Utility coverage |
| `backend/src/controllers/api/__tests__/plan.controller.vitest.test.ts` | Example controller suite already on Vitest |
| `backend/src/db/__tests__/*.vitest.test.ts` | pg-mem schema/unit coverage |
| `backend/src/middleware/__tests__/attachBearerUser.vitest.test.ts` | Express middleware |
| `backend/src/config/__tests__/googleVisionClient.vitest.test.ts` | Config helper |
| `backend/src/services/__tests__/googleSyncLatestWins.vitest.test.ts` | Complex service scenario already proven viable in Vitest |

## Contract Test Workspace (`tests/`)

These suites use `node:test` today and will need Vitest counterparts.

| File | Description | Key Dependencies |
| --- | --- | --- |
| `tests/src/plan.contract.test.ts` | Contract between API routes and shared types | Express app, `supertest`, pg fixtures, Google sync scheduler hooks |
| `tests/src/upload.contract.test.ts` | Upload flow contract test | Express, `supertest`, storage mocks |

### Shared Contract Helpers
- `tests/src/helpers/db.ts` — manages pg-mem setup and schema application (`applySchema`, `wireDbClient`).
- Contract suites expect deterministic env vars (`GOOGLE_SYNC_ENABLE_TEST`, etc.) and rely on backend internals; these need Vitest-friendly setup hooks.

## Fixture & Setup Considerations
- **pg-mem schemas**: used across multiple suites; rewrite into Vitest lifecycle helpers (`beforeAll`, `afterAll`).
- **Express + supertest harnesses**: centralize app creation to reuse in Vitest tests.
- **Scheduler hooks**: google sync tests call `__setGoogleSyncSchedulerForTests`; ensure Vitest resets state between cases.
- **Environment toggles**: numerous suites set `process.env.NODE_ENV = 'test'`, `GOOGLE_SYNC_ENABLE_TEST`, etc.—we should provide a shared setup file to standardize.

## Next Steps (Phase 2 Preview)
- Extend `backend/vitest.config.ts` with global setup (pg-mem, env resets) and longer timeouts for integration suites.
- Develop reusable Vitest fixtures mirroring the helper patterns observed above, so conversions are consistent.
