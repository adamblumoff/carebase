# Testing Overview – October 2025

This overview captures the automated test suites currently in place, the coverage we’re tracking, and the highest-value areas still missing tests.

## Current Test Suites

### Backend (`@carebase/backend`)
- **Node test runner (`tsx --test`)**  
  - Integration coverage for Express controllers, Google sync workflows, webhook ingestion, and parsing/plan services.  
  - Contract-focused tests run against pg-mem to simulate Postgres behaviour (appointments, bills, collaborators).
- **Vitest Unit Suites**  
  - Lower-level coverage for controller helpers, plan payload builders, and Google sync “latest-write-wins” logic.
- **Contract Tests (`tests/` workspace)**  
  - TAP + Supertest suites verifying API payloads match shared types, using pg-mem for fast feedback.

### Mobile (`@carebase/mobile`)
- **Vitest + React Testing Library**  
  - Presenter-level tests for Plan screen, navigation helpers, theme toggles, toast provider, and Google integration hooks.  
  - API client shims (auth, plan, collaborators, uploads, Google integration) validated via mocked axios.  
  - Auth context, realtime utilities, and hooks track loading states, token storage, and event handling.
- **Coverage Thresholds**  
  - _Statements/Lines ≥ 65%, Branches ≥ 55%, Functions ≥ 65%_.  
  - Presenter/helpers measured; UI-heavy React Native screens are excluded by design.

### Shared & Contracts
- Shared types compile during all builds; `tests/src/plan.contract.test.ts` enforces payload shape compatibility.
- No standalone coverage instrumentation yet for the `shared/` workspace.

## Coverage Snapshot

| Workspace | Tooling | Current Highlights |
|-----------|---------|--------------------|
| Backend   | `tsx --test`, Vitest | High coverage around Google sync push/pull cycles, webhook ingestion, plan payloads. Critical routes exercised with pg-mem. |
| Mobile    | Vitest + RTL | Core logic layers at/above thresholds; presenters, providers, hooks, and API shims covered. UI rendering tests intentionally excluded. |
| Tests (contracts) | TAP | Ensures API responses align with shared TypeScript contracts. |

_Note: We intentionally exclude React Native screen snapshot tests due to historic flakiness; logic extracted into presenters or hooks is covered instead._

## High-Value Coverage Gaps

1. **Plan & Navigation flows – Mobile UI**
   - Lightweight integration tests (or additional presenter helpers) for `PlanScreen` interactions, collaborator widgets, and navigation guard flows would increase confidence without reintroducing flakey render suites.

2. **Realtime & Webhook End-to-End**
   - Add backend-to-mobile integration tests that simulate webhook → sync → realtime emit → mobile listener to ensure the “latest write wins” path stays intact.

3. **Shared Workspace Instrumentation**
   - Hook up coverage for `shared/` types/helpers where feasible (even if minimal) so builds flag accidental dead code or untyped exports.

4. **Failure Path Testing**
   - Backend: exercise Google credential rotation errors, watch renewal failures, and webhook signature mismatch pathways to ensure logging & alerting integrate cleanly.
   - Mobile: cover offline retries for plan refresh and collaborator invite flows.

5. **Performance/Load Testing Hooks**
   - Contract tests currently hit happy paths; layering stress scenarios (large plan payloads, 2500+ Google events) would help catch pagination or batch-processing regressions.

## Next Steps

- Decide whether to introduce a light RN render test harness (limited to critical flows) or keep expanding presenter-level tests.
- Integrate coverage reporting for the `shared/` workspace and combine results in the root `npm run coverage`.
- Document testing expectations in contributing guidelines so new features ship with corresponding unit/integration tests.

Update this file whenever suites expand or coverage thresholds change.***
