# Backend Test Inventory (Vitest Migration Phase 1)

This inventory captures every backend test suite currently running under the Node/tsx runner or other harnesses, and highlights their key dependencies. It serves as the checklist for the upcoming Vitest migrations.

## Node Runner Suites (`node:test` → Vitest)

All previously `node:test` suites now have Vitest equivalents. Legacy filenames map to their replacements below:

| Legacy File | Vitest Suite |
| --- | --- |
| `backend/src/controllers/api/plan.test.ts` | `backend/src/controllers/api/plan.integration.vitest.test.ts` |
| `backend/src/controllers/api/upload.test.ts` | `backend/src/controllers/api/upload.vitest.test.ts` |
| `backend/src/routes/webhook.integration.test.ts` | `backend/src/routes/webhook.integration.vitest.test.ts` |
| `backend/src/routes/webhook.clerk.integration.test.ts` | `backend/src/routes/webhook.clerk.integration.vitest.test.ts` |
| `backend/src/routes/api/collaborators.test.ts` | `backend/src/routes/api/collaborators.vitest.test.ts` |
| `backend/src/routes/api/integrations/google.test.ts` | `backend/src/routes/api/integrations/google.vitest.test.ts` |
| `backend/src/services/parser.test.ts` | `backend/src/services/parser.vitest.test.ts` |
| `backend/src/services/planRealtimePublisher.test.ts` | `backend/src/services/planRealtimePublisher.vitest.test.ts` |

Shared helper: `backend/src/services/googleSync.testUtils.ts` (utilities to stand up pg-mem + Google mocks for integration suites).

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

These suites now use Vitest and rely on the backend workspace via relative imports.

| File | Description | Key Dependencies |
| --- | --- | --- |
| `tests/src/plan.contract.vitest.test.ts` | Contract between API routes and shared types | Express app, `supertest`, pg fixtures, Google sync scheduler hooks |
| `tests/src/upload.contract.vitest.test.ts` | Upload flow contract test | Express, `supertest`, storage mocks |

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

## Coverage Alignment Notes
- Backend and contract suites now report coverage through Vitest (`npm run test:coverage --workspace=backend`), and the monorepo aggregate runs via `npm run coverage`.
- Mobile coverage is unchanged but also Vitest-backed; both workspaces emit text + summary reports before pruning their temporary `coverage/` directories.
