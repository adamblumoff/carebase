# Plan: Medication Daily Checkbox Experience

## Goal
Replace the current “Mark taken” button workflow with a caregiver-friendly daily checkbox model that keeps precise audit history, resets before the next dose window, and continues to power reminders without introducing data clutter. Focus the changes on owners for now while preserving redundant timestamps for compliance.

## Milestone 0 — Discovery & Alignment
1. Confirm caregiver expectations via quick stakeholder review: single checkbox per scheduled dose, warning on double tap, no collaborator edits yet.
2. Inventory existing reminder jobs/local notifications to understand how daily resets affect scheduling.
3. Document compliance requirements: maintain historical timestamps even when the surface UI shows a single checkbox state.

## Milestone 1 — Data Model & Shared Types
1. Extend `shared/types` with a `MedicationDoseOccurrence` shape capturing:
   - `doseId`, `occurrenceDate`, `status`, `acknowledgedAt`, `acknowledgedByUserId`, `overrideCount`.
   - `history`: ordered list of `(eventType, occurredAt, actorUserId)` to preserve multiple timestamps.
2. Update backend zod schemas and shared request/response payloads to include new checkbox state plus history blocks.
3. Adjust pg schema (single migration):
   - Add `occurrence_date` (DATE) and `status` enum (`pending`, `taken`, `skipped`) to `medication_intakes`.
   - Add `override_count` INT default 0.
   - Create `medication_intake_events` table for redundant timestamp logging.
   - Add unique constraint `(medication_id, dose_id, occurrence_date)`.
4. backfill migration script to populate `occurrence_date` from `scheduled_for::date` and move historical duplicates into `medication_intake_events`.

## Milestone 2 — Backend Services & Scheduler
1. Update `medicationService` helpers:
   - New `getDailyOccurrences` that returns current-day intake with history.
   - Replace `recordMedicationIntake` logic with `setDoseStatus` that toggles between `pending`, `taken`, `skipped`, increments `override_count`, and records events.
2. Implement `resetDailyOccurrences` job:
   - Runs hourly, looks one hour before each upcoming dose window (`time_of_day - 60 minutes` adjusted for timezone).
   - Resets status back to `pending`, clears `acknowledgedAt`, and schedules reminders for the new occurrence.
3. Modify reminder scheduler to:
   - Cancel jobs when status becomes `taken` or `skipped`.
   - Respect the one-hour pre-window reset (no duplicate notifications).
4. Add `DELETE /api/medications/:id/intakes/:intakeId` guard to prevent removing current-day occurrence unless necessary (owner-only) — reuse existing delete path but ensure the daily checkbox stays consistent.
5. Bump tests: services, reminders, contract suites verifying new fields and reset behavior.

## Milestone 3 — Mobile API & State Management
1. Extend `mobile/src/api/medications.ts` with response DTO containing `occurrences` (today + historical).
2. Update `useMedications` hook to:
   - Store occurrence state per medication.
   - Expose actions `toggleOccurrenceStatus`, `undoOccurrence`.
   - Handle optimistic updates and fallback refetch.
3. Refresh local notification sync to mirror only pending occurrences; cancel when status flips.

## Milestone 4 — Mobile UI/UX Refresh
1. Plan screen summary:
   - Replace current “Mark taken” CTA with checkbox chips per active dose.
   - Show completed items collapsed under “Completed today” with timestamp.
   - Overdue state: red outline + “Overdue” pill.
2. Medication detail sheet:
   - “Today” section with checkbox cards, skip link, and “undo” control.
   - “History” section: chronological list of past days with taken/skipped icons and times (read-only).
3. Override flow:
   - When a checked card is tapped again, show alert “You already marked this taken. Override?” with confirm/cancel.
   - On confirm, increment override history and keep status `taken`.
4. Disable collaborator interaction (checkbox controls hidden or disabled when `canManage` is false).
5. Update tests: MedicationDetailSheet and PlanScreen integration to validate checkbox flow, override dialog, and historical rendering.

## Milestone 5 — Documentation & QA
1. Update `docs/medications.md`, `docs/testing.md`, and `AGENTS.md` with checkbox model, reset timing, override warnings, and audit expectations.
2. Add runbook steps for monitoring `medication_intake_events` growth and troubleshooting resets.
3. Automated tests: run backend, contracts, mobile suites; add new coverage for reset scheduler (fake clock) and hook interactions.
4. Manual QA checklist:
   - Create medication, confirm checkbox resets an hour before next dose.
   - Tap checkbox twice to verify warning and override logging.
   - Ensure reminders stop after check and resume after auto-reset.

## Dependencies & Risks
- Reset job must respect timezones and daylight savings transitions; test thoroughly.
- Storing history in `medication_intake_events` increases storage; plan retention/archival later.
- Override flow must remain intuitive; too many alerts could frustrate caregivers.

## Exit Criteria
- Checkbox UI live for owners, collaborators view-only.
- Backend stores daily status + redundant timestamps with audit-friendly history.
- Reminder engine aligned with one-hour pre-reset rule.
- Documentation and QA procedures updated; tests green across workspaces.
