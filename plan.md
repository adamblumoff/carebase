# Backend Coverage Acceleration Plan

We’re at ~70% line / 81% function coverage. To push toward an “A” grade, we’ll tighten the remaining hot spots, focusing on untested branches in the DB layer and controller edge cases. Each phase ends with a commit after tests pass.

## Phase 1 — DB Query Branch Sweep
- Audit Vitest reports to identify uncovered branches in `src/db/queries/appointments.ts`, `bills.ts`, `collaborators.ts`, and `recipients.ts`.
- Add or extend unit/integration specs that exercise owner vs. collaborator paths, queue toggles, and sanitization fallbacks.
- Ensure new tests reuse existing fixtures/helpers (pg-mem, plan touch stubs) to avoid regressions.

## Phase 2 — Controller & Utility Edge Coverage
- Cover error/validation branches in controllers (`upload.ts`, webhook handlers) and services (`storage.ts`, `metrics.ts`).
- Verify SecureStore/AsyncStorage fallbacks and raw-body verification paths.
- Mock external responders (OCR, S3, Resend) as needed to keep tests fast and deterministic.

## Phase 3 — Verification & Documentation
- Run `npm run test --workspace=backend`, `npm run coverage`, and collect updated coverage-summary metrics.
- Record before/after coverage deltas and update contributor docs with any new testing conventions or thresholds.
- Confirm backend function coverage stays ≥85% and line coverage trends toward ≥75%; adjust future targets if needed.
