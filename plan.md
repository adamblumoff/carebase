# Plan: Medication Management & Reminder Loop

## Goal
Launch a first-class medication management experience that lets caregivers capture prescriptions, schedule fixed-time doses, receive persistent reminders, and acknowledge intake, while projecting refills and reusing existing infrastructure. Scope is intentionally MVP-friendly: owners manage medications, collaborators see read-only data, and analytics/compliance enhancements are deferred.

## Milestone 0 — Kickoff & Alignment
1. Finalize requirements in docs/ (add `docs/medications.md` outlining fields, permissions, reminder rules, and non-goals). Include ERD sketches and sequence diagrams for reminder escalation.
2. Review plan with product + compliance to ensure start/end date handling, provider metadata, and notification cadence meet expectations.
3. Create Linear/Jira epics for each milestone to track progress and cross-team dependencies.

## Milestone 1 — Data Model & Shared Types
1. Update `backend/src/db/schema.sql`:
   - Introduce `medications` table (id, recipient_id FK, owner_id FK, name, strength_value, strength_unit, form, instructions, notes, prescribing_provider, start_date, end_date, quantity_on_hand, refill_threshold, preferred_pharmacy, created_at, updated_at, archived_at).
   - Add `medication_doses` table (id, medication_id FK, label, time_of_day, timezone, reminder_window_minutes default 120, is_active).
   - Add `medication_intakes` table (id, medication_id FK, dose_id FK nullable, scheduled_for timestamptz, acknowledged_at timestamptz, status enum `taken|skipped|expired`, actor_user_id FK).
   - Add `medication_refill_forecasts` materialized view or helper table for projected refill date (medication_id, expected_run_out_on).
2. Create migration script if schema is managed incrementally; otherwise update docs on running `npm run db:migrate --workspace=backend`.
3. Extend pg-mem fixtures in `tests/src/helpers/db.ts` and other contract helpers to mirror new tables.
4. Update shared types (`shared/types/index.ts`) with `Medication`, `MedicationDose`, `MedicationIntake`, `MedicationRefillProjection`, request/response payloads, and enums.
5. Regenerate TypeScript barrels if needed and add zod schema definitions for API validation (`shared/types/validation.ts` if present).
6. Document new tables in `docs/architecture.md` and include ERD snippet.

## Milestone 2 — Backend Services & API Surface
1. Create `backend/src/services/medicationService.ts` handling CRUD, intake acknowledgements, refill projections, and generating reminder jobs.
2. Build repository/query helpers (`backend/src/db/queries/medications.ts`, `medicationDoses.ts`, `medicationIntakes.ts`) with transactional helpers for creating medication + doses atomically.
3. Add auth guard helpers to enforce owner-only mutations; extend `backend/src/middleware/requireOwner.ts` if necessary.
4. Implement controllers + routes:
   - `POST /api/medications` for creating (manual/OCR) entries.
   - `GET /api/medications` to list active medications with doses, intake status, and refill projections.
   - `GET /api/medications/:id`, `PATCH /api/medications/:id`, `PATCH /api/medications/:id/archive`.
   - `POST /api/medications/:id/doses` & `PATCH /api/medications/:id/doses/:doseId` for schedule management.
   - `POST /api/medications/:id/intakes` to acknowledge `taken` or `skipped`.
5. Update route registry metadata (`backend/src/routes/registry.ts` + `.metadata.ts`) and ensure dependency-cruiser rules stay satisfied.
6. Extend Clerk-based authorization to expose medication scopes in `backend/src/services/clerkAuthGateway.ts` if needed.
7. Write unit tests (`backend/src/services/__tests__/medicationService.vitest.test.ts`) and controller tests using supertest/pg-mem; add contract coverage in `tests/src/medications.contract.test.ts`.
8. Update error handling to map domain errors (e.g., editing archived medication, unauthorized collaborator) to HTTP 403/409 responses.

## Milestone 3 — Reminder & Notification Engine
1. Design reminder state machine: initial reminder at scheduled time, repeat every 120 minutes until intake recorded, fire end-of-day summary, then daily nags until intake complete.
2. Extend existing job infrastructure:
   - Add scheduler module (`backend/src/services/medicationReminderScheduler.ts`) that seeds cron/queue jobs when doses are created or updated.
   - Reuse current queue / worker (`services/realtime` or background worker) to enqueue Expo push payloads; add medication-specific templates.
   - Store pending jobs in `medication_reminder_jobs` table or leverage existing delayed-job mechanism.
3. Implement logic to cancel/reschedule jobs when user records an intake or medication is archived.
4. Add final notification generator that emits once per day for overdue doses; ensure it respects timezone and start/end dates.
5. Integrate with Expo push provider: add new notification categories (`medication-reminder`, `medication-missed`) and payload builders in `backend/src/services/email.ts` or a dedicated push helper.
6. Write unit tests for scheduler state transitions and integration tests that simulate a full day with pg-mem + fake clock.
7. Update observability: emit structured logs/metrics for reminders sent, acknowledgements, and missed doses; add basic dashboard/alerts if existing stack supports it.

## Milestone 4 — Mobile UX & OCR Capture
1. Create medications feature directory (`mobile/src/screens/medications`) with:
   - `MedicationListScreen` listing active medications, dose status, overdue badges.
   - `MedicationDetailScreen` showing instructions, schedule, refill estimate, and intake history summary (last 7 days).
   - `MedicationIntakeSheet` component for “Mark taken” / “Skip” actions.
   - Navigation updates in `mobile/src/navigation/AppNavigator.tsx` to add tab/stack entry.
2. Build API client (`mobile/src/api/medications.ts`) and associated hooks (`mobile/src/hooks/useMedications.ts`, `useMedicationIntake.ts`) with optimistic updates on acknowledgements.
3. Implement manual entry form (`MedicationEditScreen` or modal) respecting owner-only editing; ensure collaborators fall back to read-only state.
4. Integrate OCR:
   - Extend existing upload flow with a `Scan Prescription` option launching camera.
   - Add new OCR endpoint `POST /api/upload/medication-label` or reuse generic upload by passing intent flag.
   - Map parsed fields to form defaults; allow user to adjust before saving.
5. Wire push notification handling: register new Expo notification categories, display in-app banners, deep-link taps to the relevant medication detail.
6. Add local reminders fallback (optional) if backend push fails—log but defer full offline support.
7. Create Vitest suites for hooks/components (`*.vitest.test.tsx`) and integration tests for navigation flows; mock Expo notifications to verify acknowledgement callouts.

## Milestone 5 — Testing, QA, and Rollout
1. Backend
   - `npm run test:backend`, `npm run test:contracts`, add new coverage expectations for medication modules.
   - Run manual pg-mem scenario to simulate multi-day adherence.
2. Mobile
   - `npm run test --workspace=mobile`; exercise flows on iOS + Android simulators (Expo Go).
   - Validate notification receipt and deep links; confirm collaborator accounts receive read-only views.
3. OCR
   - Collect sample prescription labels; confirm parser populates fields with acceptable accuracy.
4. Performance & load
   - Evaluate reminder job volume vs queue capacity; add rate limiting or batching if required.
5. Documentation & enablement
   - Update `README.md`, `docs/DETAILS.md`, `docs/architecture.md`, and create `docs/notification-matrix.md`.
   - Record Loom or screenshot walkthrough for support team.
6. Rollout
   - Behind feature flag (env var `ENABLE_MEDICATIONS`); enable for internal testers first.
   - Migrate production schema, deploy backend, release mobile update via Expo EAS, then flip flag.
   - Monitor logs/metrics, gather feedback, and plan post-launch enhancements (analytics, collaborator editing, SMS).

## Milestone 6 — Post-Launch Enhancements (Backlog Seed)
1. Adherence analytics dashboard (missed doses, streaks).
2. Collaborator editing with audit trail.
3. SMS/email notification channels with opt-in management.
4. Compliance review for storage encryption and audit logs.
5. Advanced schedules (every X hours, tapers, PRN logging).

## Dependencies & Risks
- **Dependencies**: Expo push service quota, reliable clock source for scheduler, OCR model accuracy for prescription labels, existing auth scopes for owner verification.
- **Risks**: Reminder spam if cancellation fails; mitigate with idempotent job cancellation and observability. OCR misclassification; mitigate with manual review screen. Feature creep; mitigate via feature flag and milestone gating.

## Exit Criteria
- Schema + shared types merged, migrations applied in staging.
- Backend routes pass contract tests; reminder engine verified with fake clock integration tests.
- Mobile client displays medications, handles intake actions, and receives push notifications across platforms.
- OCR flow produces editable drafts with >80% field accuracy on test set.
- Runbook created for support with troubleshooting steps for reminders and refill projections.
- Feature flag enabled for pilot group with positive feedback and <5% reminder failure rate over first week.

