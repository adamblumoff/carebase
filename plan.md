# Backend Coverage Acceleration Plan

We’re targeting an “A” grade for backend test coverage by closing remaining gaps and documenting the new workflow. Each phase ends with a commit after tests pass.

## ✅ Phase 1 — DB Query Branch Sweep
- Audited Vitest reports for low-coverage branches in `src/db/queries/appointments.ts`, `bills.ts`, `collaborators.ts`, and `recipients.ts`.
- Added targeted pg-mem integration specs to exercise owner vs. collaborator paths, queue toggles, and sanitization fallbacks.
- Reused existing pg-mem helpers to avoid regressions and keep suites fast.

## ✅ Phase 2 — Controller & Utility Edge Coverage
- Covered error/validation branches in controllers (`upload.ts`, webhook handlers) and services (`storage.ts`, `metrics.ts`).
- Verified SecureStore/AsyncStorage fallbacks and raw-body verification paths via focused unit tests.
- Stubbed external responders (OCR, S3, Resend) to keep suites deterministic.

## ✅ Phase 3 — Verification & Documentation
- Ran `npm run test --workspace=backend` and `npm run coverage` to confirm the full Vitest suite passes.
- Captured the latest coverage snapshot (backend: 71.82 % lines / 68.63 % branches / 82.64 % functions) and recorded highlights in `docs/testing.md`.
- Documented the consolidated Vitest workflow so new contributors follow the same commands and expectations.

Next initiative: expand coverage instrumentation to the `shared/` workspace and add cross-runtime end-to-end tests once priorities realign.
