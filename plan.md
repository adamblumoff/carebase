# Plan: Medication Hard Delete & Intake UX Rethink

## Goal
Deliver owner-only hard deletion for medications and their dose/intake history while preserving an auditable trail, and lay the groundwork for simplifying the “Mark Taken” experience into an intuitive daily checkbox workflow with multi-intake safeguards.

## Milestone 0 — Alignment
1. Confirm clinical/compliance expectations: owners may permanently delete medications; collaborators stay read-only; audit entries must capture actor, subject IDs, and before/after snapshot.
2. Catalog existing reminder jobs, local notifications, and OCR drafts tied to medications so hard deletes can clean them up.

## Milestone 1 — Backend Hard Delete Support
1. **Shared Types**: extend `@carebase/shared` payloads with `MedicationDeleteResponse` and `MedicationIntakeDeleteResponse`; update generated zod schemas and map into API docs.
2. **Validators**: add params schemas for `DELETE /api/medications/:id` and `DELETE /api/medications/:id/intakes/:intakeId`; ensure owner-only guard remains enforced.
3. **Service Layer**:
   - Implement `deleteMedicationForOwner` that resolves recipient + owner collaborator, wraps operations in a transaction, and removes:
     - medication row,
     - related doses, intakes, refill projections,
     - queued reminder jobs/locks,
     - OCR drafts or upload relations.
   - Implement `deleteMedicationIntakeForOwner` to remove a single intake and trigger reminder re-evaluation.
4. **Queries**: create hard-delete helpers inside `backend/src/db/queries/medications.ts` plus any reminder queue adapters; ensure cascading deletes respect FK constraints without relying solely on `ON DELETE CASCADE`.
5. **Controllers/Routes**: expose `DELETE /api/medications/:id` and `DELETE /api/medications/:id/intakes/:intakeId`; return updated medication payload (or 204 for full delete) matching shared contract.
6. **Reminder Cleanup**: cancel pending Expo/local notifications for removed doses; if an intake is deleted, re-seed next reminder window.

## Milestone 2 — Mobile Deletion UX
1. **API Client**: add `deleteMedication` and `deleteMedicationIntake` calls to `mobile/src/api/medications.ts` with typed responses and error normalization.
2. **Hooks & State**: extend `useMedications` and related selectors with deletion actions, optimistic removal, and fallback refetch on failure; handle 404/409 gracefully.
3. **UI Flow**:
   - Medication detail sheet: surface destructive actions with confirmation modals (include warning copy about permanent removal and reminder cancellation).
   - Intake history list: enable swipe-to-delete or overflow action for each intake; warn user before deletion.
   - After a full medication delete, close sheets, navigate back to plan summary, and purge any pending local reminders.
4. **Accessibility**: ensure destructive buttons have accessible labels and confirmation dialogs announce permanence.

## Milestone 3 — Audit Logging & Documentation
1. Record audit events via existing `audit` table for both medication deletes and intake deletes, storing actor user ID, medication/intake identifiers, and snapshot metadata (name, dose label, scheduled time).
2. Update `docs/medications.md`, `docs/testing.md`, and `AGENTS.md` with new endpoints, audit expectations, and manual QA steps.
3. Add runbook guidance for restoring mistakenly deleted medications (re-upload prescription) and querying audit trails.

## Milestone 4 — Testing & QA
1. **Automated**: extend backend unit + contract tests to cover deletion happy paths and guard failures; expand mobile Vitest suites for hooks/UI (mock API responses, optimistic rollback).
2. **Manual**: on dev build, create medication with doses/intakes, delete an intake, verify reminder recalculation, then delete medication and confirm removal across plan, camera scan drafts, and notifications.
3. Re-run full suites: `npm run test:backend`, `npm run test:contracts`, `npm run test --workspace=mobile`, and lint if required.

## Milestone 5 — Upcoming “Mark Taken” Checkbox Redesign
1. Replace per-intake timestamp logging with a day-bound checkbox per scheduled dose that automatically resets at the next scheduled occurrence (24-hour window respecting timezone).
2. Track duplicate confirmations: if a user attempts to mark taken more than once inside the window, prompt with “You’ve already marked this dose taken—continue?” and log the override.
3. Persist checkbox state server-side so reminders and summaries mirror the simplified status; archive detailed intake history to the audit log.
4. Update plan detail and summary cards to reflect checkbox state rather than list of timestamps; ensure collaborators remain view-only.
5. Revisit analytics to ensure adherence metrics can derive from checkbox state.

## Dependencies & Risks
- Need reliable reminder cancellation to prevent orphaned push notifications.
- Audit table growth may require pruning strategy; monitor storage.
- Hard delete removes historical data—support must rely on audit trail exports when troubleshooting.

## Exit Criteria
- New delete endpoints live, protected, and covered by tests.
- Mobile client supports confirmation-driven deletion flows with optimistic UX.
- Audit entries populate for every delete action and documentation/runbooks updated.
- Future checkbox redesign scoped with clear next steps for engineering and product.
