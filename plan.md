# Carebase Refactoring Plan

This document captures the approach for tightening backend boundaries and simplifying the mobile core while keeping the monolith structure lean. It is intended to guide current work and serve as a reference for future iterations.

---

## Objectives
- Reduce cross-layer coupling in the backend so that persistence, realtime, and authentication evolve independently.
- Lighten the React Native navigation + configuration layer to keep future feature additions scoped and maintainable.
- Leave pragmatic guardrails (tests/linters/docs) to keep the system lean as it grows.

---

## Backend Boundary Tightening

### 1. Establish a Clerk Auth Gateway
| Item | Details |
| --- | --- |
| **Goal** | Centralize Clerk-specific session verification and client handling without exposing broader service logic. |
| **Actions** |<ul><li>Create `backend/src/services/clerkAuthGateway.ts` exporting `getClerkClient()` and `verifyClerkSessionToken()`.</li><li>Move the logic from `clerkSyncService.ts` into this gateway (reuse existing tests).</li><li>Update `clerkSyncService.ts` and `realtime.ts` to import from the gateway.</li><li>Ensure tests covering session verification and Clerk sync continue to pass; add focused unit tests for the gateway if needed.</li></ul>|
| **Risks / Mitigations** | Potential duplication of config handling—minimize by reusing existing helpers; ensure environment checks remain in one place. |

### 2. Decouple Realtime Emitter From DB Queries
| Item | Details |
| --- | --- |
| **Goal** | Keep `db/` layer focused on persistence while letting services orchestrate realtime side-effects. |
| **Actions** |<ul><li>Introduce `backend/src/realtime/emitter.ts` exposing `setRealtimeEmitter()` / `getRealtimeEmitter()`.</li><li>Move emitter state out of `db/queries/shared.ts` and adjust imports accordingly (`services/realtime.ts` remains owner).</li><li>Refactor query modules that relied on implicit emitters to either receive the emitter via parameters or call the accessor.</li><li>Update integration tests to mock the emitter through the new module.</li></ul>|
| **Risks / Mitigations** | Widespread import updates—batch them carefully; verify there are no circular imports by running dep analysis (`dependency-cruiser` script). |

### 3. Add Dependency Guardrails
| Item | Details |
| --- | --- |
| **Goal** | Prevent regressions after refactor. |
| **Actions** |<ul><li>Configure `dependency-cruiser` to forbid imports from `backend/src/db/**` to `backend/src/services/**`.</li><li>Add a lint/test script (e.g., `npm run lint:deps`) and wire it into CI.</li><li>Document the rule in `docs/architecture.md` (or create a new section).</li></ul>|
| **Risks / Mitigations** | False positives if generated code exists—scope the rule to `.ts` files only. |

### 4. Documentation Pass
- Update backend architecture docs with the new layering.
- Capture the responsibilities of the auth gateway and realtime emitter for future contributors.

---

## Mobile Core Simplification

### 1. Extract Navigation Types
| Item | Details |
| --- | --- |
| **Goal** | Remove the circular dependency between `AppNavigator` and screens while clarifying route contracts. |
| **Actions** |<ul><li>Create `mobile/src/navigation/types.ts` containing `RootStackParamList` and any shared navigation enums.</li><li>Update screens to import types from `navigation/types.ts` instead of `AppNavigator.tsx`.</li><li>Keep `AppNavigator.tsx` focused on runtime setup; ensure re-export of types if required by tests.</li></ul>|
| **Risks / Mitigations** | Ensure all tests/Storybook stories still compile by running `npm run test --workspace=mobile`. |

### 2. Split Configuration Concerns
| Item | Details |
| --- | --- |
| **Goal** | Prevent `config.ts` from becoming a dumping ground and ease mocking in tests. |
| **Actions** |<ul><li>Create `mobile/src/config/env.ts` to parse environment variables with defaults.</li><li>Split feature-specific config into modules: e.g., `mobile/src/config/apiEndpoints.ts`, `mobile/src/config/oauth.ts`.</li><li>Update call sites to import the narrower module(s).</li><li>Provide a simple `config/index.ts` that re-exports for backwards compatibility (temporary shim) and mark it deprecated.</li></ul>|
| **Risks / Mitigations** | Search-and-replace touches many files—do it incrementally with tests between steps. |

### 3. Test & Type Guardrails
- Add lightweight tests for config modules (ensuring defaults fall back correctly).
- Consider TypeScript interfaces for env config to catch missing variables.
- Document the pattern for adding new endpoints/config items.

---

## Validation & Tooling
- **Automated Checks**: run `npm run test:backend`, `npm run test --workspace=mobile`, and contract tests after each major phase.
- **Dependency Scan**: re-run the custom dependency analysis scripts to ensure cycles are removed.
- **Manual QA**: smoke test realtime plan updates and mobile navigation after changes.

---

## Sequencing Summary
1. Backend: auth gateway → realtime emitter extraction → dependency guardrail → doc update.
2. Mobile: navigation types extraction → config split → add tests/notes.
3. Run full test suite and update docs accordingly.

---

## Open Questions / Follow-Ups
- Should the auth gateway expose additional helpers (e.g., metadata builders) or remain minimal?
- Do we need a feature flag for gradually adopting the new config modules on mobile?
- Would adding an ADR (Architecture Decision Record) help track this shift for future contributors?
