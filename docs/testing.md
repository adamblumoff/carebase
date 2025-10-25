# Testing Overview – October 25, 2030

This overview captures the automated test suites currently in place, the coverage we’re tracking, and the highest-value areas still missing tests.

## Current Test Suites

### Backend (`@carebase/backend`)
- **Vitest (unit + integration)**  
  - Single runner for all suites, including Express integration tests, Google sync workflows, webhook ingestion, parsing/plan services, and db query coverage via pg-mem.  
  - Contract-style tests from the `tests/` workspace now execute through Vitest as well, so controller payload checks and API contract assertions share the same tooling and reporters.  
  - Command: `npm run test --workspace=backend`
- **Coverage**  
  - Command: `npm run test:coverage --workspace=backend` (root `npm run coverage` runs backend → contracts → shared → mobile).  
  - Generates v8 coverage for statements, branches, functions, and lines; each workspace script removes its local `coverage/` folder after reporting so CI stays clean.

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
- `npm run coverage` now invokes `vitest --coverage` inside the `shared/` workspace, so any future shared helpers automatically roll into the global coverage summary (currently minimal until dedicated specs are added).

## Coverage Snapshot

Latest snapshot (after `npm run coverage` on October 25, 2030):

| Workspace | Lines | Branches | Functions | Statements | Notes |
|-----------|-------|----------|-----------|------------|-------|
| Backend   | 71.82 % | 68.63 % | 82.64 % | 71.82 % | Google sync suites, webhook integrations, storage/metrics helpers, and db query branches now run under Vitest. |
| Mobile    | 98.70 % | 89.47 % | 80.00 % | 98.70 % | Logic layers, presenters, and hooks are fully covered; UI-heavy screens remain intentionally excluded. |
| Contracts (`tests/`) | counted with Backend | counted with Backend | counted with Backend | counted with Backend | Contract suites execute inside the backend Vitest run, so their coverage rolls into backend totals. |

_Note: We intentionally exclude React Native screen snapshot tests due to historic flakiness; logic extracted into presenters or hooks is covered instead._

## High-Value Coverage Gaps

1. **Shared Workspace Instrumentation**
   - Coverage still skips the `shared/` package. Adding lightweight Vitest suites (even smoke-level) would surface unused exports and regressions in shared DTO parsers.

2. **Realtime + Mobile Consumption**
   - End-to-end validation of webhook → Google sync → realtime emitter → mobile listener remains manual. A combined contract test (backend + mobile) would harden this flow.

3. **Mobile Offline & Error Recovery**
   - Hooks that manage offline retries (plan refresh, collaborator invites) are partially covered. Add network-failure cases to ensure exponential backoff and user messaging behave.

4. **Stress Scenarios**
   - Contract suites cover happy paths; simulate large Google calendar payloads (2,500+ events) and bulk collaborator imports to detect pagination or batching regressions ahead of time.

## Next Steps

- Integrate coverage reporting for the `shared/` workspace and combine results in the root `npm run coverage`.
- Decide whether to reintroduce a constrained RN render harness for critical flows or continue investing in presenter-level tests only.
- Document expectations in CONTRIBUTING (tests + coverage deltas) when the shared coverage work lands.

Update this file whenever suites expand or coverage thresholds change.***
