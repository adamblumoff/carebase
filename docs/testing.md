# Testing Overview — October 30, 2025

This document tracks the automated suites in the monorepo, where coverage stands, and the manual checks we expect before shipping medication updates.

## Current Test Suites

### Backend (`@carebase/backend`)
- **Vitest (unit + integration)**  
  - Exercises Express controllers, service layers, pg-mem backed queries, Google sync pipelines, and background jobs.  
  - Medication coverage now includes the daily checkbox workflow (`medicationService`, `medicationReminderScheduler`, `medicationOccurrenceReset`) with fake timers and pg-mem fixtures.  
  - Command: `npm run test --workspace=backend` (alias `npm run test:backend` from repo root).
- **Contract Suites**  
  - Located in `tests/`; executed via `npm run test:contracts`. These target shared API payloads (plan, medications, uploads) and run against the backend Express app with pg-mem.
- **Coverage**  
  - `npm run coverage` orchestrates backend → contracts → mobile coverage runs. Artifacts live under `coverage/` until the script cleans them.

### Mobile (`@carebase/mobile`)
- **Vitest + React Testing Library**  
  - Presenter-style tests verify plan summary wiring, medication checkbox UI, override prompts, and local notification synchronisation.  
  - Hooks (`useMedications`, notification schedulers) cover optimistic updates, override flows, and error handling.  
  - Command: `npm run test --workspace=mobile`.
- **Coverage Thresholds**  
  - Statements/Lines ≥ 65%, Branches ≥ 55%, Functions ≥ 65% for logic modules. Screens using heavy RN primitives stay excluded; presenters and hooks supply coverage instead.

### Shared & Tooling
- Shared DTO changes compile in all builds; medication occurrences and intake events now have dedicated type exports (`MedicationDoseOccurrence`, `MedicationIntakeEvent`).  
- Lightweight smoke specs for reminder query helpers (`backend/src/db/queries/__tests__/medicationRemindersCore.vitest.test.ts`) ensure result mapping stays aligned if schema evolves.

## Coverage Snapshot

Latest `npm run coverage` (October 30, 2025):

| Workspace | Lines | Branches | Functions | Statements | Notes |
|-----------|-------|----------|-----------|------------|-------|
| Backend   | 72.1 % | 69.0 % | 83.2 % | 72.0 % | Checkbox workflow covered via service + job suites; contract tests run inside the same Vitest invocation. |
| Mobile    | 98.5 % | 89.4 % | 80.1 % | 98.6 % | Medication summary/detail tests now assert checkbox + override behaviour and notification syncing. |
| Contracts | included with backend | included with backend | included with backend | included with backend | Contract specs execute within the backend coverage run. |

> Coverage fluctuates based on feature work—rerun the command above before requesting review to capture updated figures.

## High-Value Regression Guards
1. **Medication Reset Job** — `backend/src/jobs/__tests__/medicationOccurrenceReset.vitest.test.ts` uses fake timers to validate timezone handling and reminder scheduling. Expand when new edge-cases appear.
2. **Reminder Scheduler** — `backend/src/services/__tests__/medicationReminderScheduler.vitest.test.ts` ensures we always cancel before scheduling. Any new reminder kinds should extend this suite.
3. **Mobile Override Flow** — `mobile/src/screens/plan/medications/__tests__/MedicationDetailSheet.vitest.test.tsx` asserts warning copy and optimistic rollbacks. Update when UX copy changes.
4. **Local Notification Mirror** — `mobile/src/notifications/__tests__/localMedicationReminders.vitest.test.ts` prevents stale reminders after resets/deletes.

## Manual QA Checklist (Medications)
1. **Plan Summary** — Create a medication with two doses. Toggle each checkbox once; confirm “Completed today” collapses the entry with correct timestamp and override prompt appears on the second tap.
2. **Reset Window** — Advance device clock or run `/api/medications` after the reset job (one hour before the next dose) fires. Ensure a pending occurrence appears for tomorrow while history retains today’s acknowledgement.
3. **Override Logging** — Override an already-taken occurrence. Verify an alert appears, reminders cancel, and an audit row with `overrideCount` increments (`SELECT action, meta FROM audit WHERE action = 'medication_intake_override' ORDER BY id DESC LIMIT 1;`).
4. **Intake Deletion** — Delete a mistaken intake via the detail sheet. Confirm a pending occurrence is recreated immediately and reminders reschedule once.
5. **Medication Deletion** — Hard delete the medication. Ensure Expo/local reminders cancel, occurrences disappear from plan summaries, and audit rows `medication_deleted`/`medication_intake_deleted` record the action.

## Release Checklist
- Backend: `npm run test:backend`, `npm run test:contracts`.
- Mobile: `npm run test --workspace=mobile`.
- Optional: `npm run coverage` for a full report prior to PR.
- Manual smoke on a development build (not Expo Go) to validate notification permissions and checkbox UX.
