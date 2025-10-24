# Monorepo Vitest Migration Plan

This document tracks how we will move every test in the repository to Vitest, align coverage, and retire the legacy Node/tsx runner. Each phase ends with a commit once tasks and validations are finished.

## Phase 1 — Inventory & Gap Analysis
- Enumerate all existing backend `*.test.ts` files executed by `tsx --test`, the contract tests under `tests/`, and any ad-hoc scripts (e.g., CLI checks).
- Document fixture dependencies (pg-mem, supertest bootstraps, env loaders) and note which ones already have Vitest equivalents.
- Record any global setup/teardown requirements that will need Vitest hooks.
- Deliverables: updated inventory notes (in repo docs or comments) and confirmation that nothing is overlooked.

## Phase 2 — Vitest Baseline for Backend
- Extend/adjust `backend/vitest.config.ts` to support integration scenarios (e.g., register setup files, increase timeouts, configure globals for pg-mem/supertest).
- Introduce shared test utilities (setup files, fixtures) compatible with Vitest if legacy code relies on Node’s TAP harness.
- Verify existing Vitest suites still pass using the new configuration (`npm run test:vitest --workspace=backend`).

## Phase 3 — Migrate Backend Unit Suites
- Convert backend unit and service tests currently under `src/**/*.test.ts` to Vitest (`*.vitest.test.ts`).
- Replace TAP-specific patterns with Vitest APIs (e.g., `test()` → `it()`, custom assertions).
- Ensure mocking strategies (e.g., jest-like stubs) translate to Vitest (`vi.mock`, `vi.spyOn`).
- Run targeted Vitest commands to validate each converted module before the full suite.

## Phase 4 — Migrate Backend Integration & Contract Tests
- Move the `tests/` workspace suites (pg-mem + supertest contract tests) onto Vitest:
  - Create Vitest config/entry for the contracts workspace or fold it into the backend config.
  - Update scripts so these tests are invoked by `npm run test:vitest --workspace=tests` (or similar) with Vitest.
- Confirm integration flows still spin up databases/servers correctly under Vitest lifecycle hooks.

## Phase 5 — Clean Up Legacy Runner & Scripts
- Remove `test:node` and `tsx --test` usage from backend scripts (and any CI jobs).
- Simplify top-level `npm run test:backend` and `npm run coverage` to call Vitest-only commands mirroring the mobile workflow.
- Update GitHub workflows/CI to consume the new commands and double-check caches.

## Phase 6 — Coverage Alignment & Documentation
- Ensure coverage reporting (backend & mobile) uses a consistent Vitest configuration (report types, output locations, thresholds).
- Document new testing instructions in `README.md` / contributor docs.
- Summarize before/after coverage to verify no regressions.

## Ongoing Validation
- After each phase, run the relevant Vitest suites (and when applicable `npm run coverage`).
- Commit changes per phase with clear messages (e.g., “Inventory backend test runners”, “Convert backend services to Vitest”).
- If unexpected blockers surface (e.g., third-party libs needing custom adapters), capture them inline and adjust later phases accordingly.
