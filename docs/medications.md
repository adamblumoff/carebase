# Medications Feature — Daily Checkbox Model

_Updated October 30, 2025_

## Scope Summary
- Owners manage medications, fixed daily doses, and intake acknowledgements from the plan screen. Collaborators remain view-only for the new controls.
- Each scheduled dose now materialises as a **daily occurrence** (one per day per dose). Caregivers interact with a single checkbox that resets one hour before the next dose window. Historical timestamps remain available for compliance.
- The backend continues to power Expo push reminders and now records reminder events in a dedicated table; the mobile client mirrors the next few pending occurrences via local notifications for resilience.
- Hard deletes are supported for medications and individual occurrences while preserving an audit trail (`medication_deleted`, `medication_intake_deleted`) and re-seeding the pending occurrence when required.

## Domain Overview

```
Recipient 1─* Medication 1─* MedicationDose
                     |             |
                     |             └─* MedicationIntake (daily occurrence)
                     |
                     ├─1 MedicationRefillProjection
                     ├─* MedicationIntakeEvent (history)
                     └─* MedicationReminderEvent
```

### Medication Intake (Daily Occurrence)
- `scheduledFor` — timestamp for reminders and UI ordering.
- `occurrenceDate` — calendar date used to enforce the one-per-day constraint (`UNIQUE (medication_id, COALESCE(dose_id, 0), occurrence_date)`).
- `status` — `pending`, `taken`, `skipped`, `expired`.
- `acknowledgedAt` / `acknowledgedByUserId` — who last toggled the checkbox.
- `overrideCount` — increments when caregivers override an already taken/ skipped occurrence.
- The mobile client receives `occurrences[]` in medication payloads with a corresponding `history` block sourced from `medication_intake_events`.

### Medication Reminder Events
- `medication_reminder_events` tracks push notification lifecycle (initial → nag → final → follow_up).
- Scheduling helpers (`scheduleMedicationIntakeReminder`, `rescheduleMedicationIntakeReminder`) cancel pending events before creating a new one so overrides never duplicate reminders.
- Context payload records the reminder window minutes, occurrence date, and timezone for downstream workers.

### Intake Event History
- `medication_intake_events` captures every state transition (`taken`, `skipped`, `undo`, `override`) with timestamps and actor IDs.
- The history array returned to mobile is ordered newest first so the UI can present the most recent acknowledgement.

## Daily Reset Flow
1. Caregiver marks the checkbox (status → `taken`). Override attempts trigger a confirmation alert and, on approval, increment `overrideCount` while logging an `override` event.
2. Reminders are cancelled immediately; mobile local notifications drop the pending entry.
3. **One hour before the next scheduled dose time**, `runMedicationOccurrenceReset`:
   - Looks back two days for completed occurrences.
   - Skips anything still pending/expired or already reset.
   - Creates the next day’s occurrence (status `pending`) and schedules a fresh reminder event.
   - Touches the plan feed to refresh summary data for caregivers.
4. When the plan reloads, mobile shows the new checkbox in the “Today” section. Historical occurrences fall into the “History” list but retain their original timestamps.

Environment switches:
- `MEDICATION_RESET_ENABLED` (default `true`) — disable the worker if we need to pause resets.
- `MEDICATION_RESET_INTERVAL_MS` — interval for the in-process scheduler (default 15 minutes). Production will use a dedicated cron once validated.

## Mobile UX Summary
- **Plan Summary** — Each active dose renders a checkbox chip. Completed occurrences collapse beneath “Completed today” with the timestamp of the last acknowledgement.
- **Detail Sheet** — “Today” section shows checkbox cards (taken/skipped/pending). Tapping a completed card prompts for override confirmation. “History” lists prior days in reverse chronological order with badges and times.
- **Notifications** — Expo push reminders remain the source of truth; the local fallback mirrors pending occurrences only. Local notifications clear when status flips or when a new occurrence replaces the previous day’s entry.

## API Highlights
- `GET /api/medications` returns `occurrences[]` and `occurrenceHistory` for each medication.
- `PATCH /api/medications/:id/intakes/:intakeId` replaced with `PATCH ... setStatus` helper internally (service now routes through `setDoseStatus`).
- `DELETE /api/medications/:id/intakes/:intakeId` removes an intake and recreates the pending occurrence when that day would otherwise be missing, ensuring caregivers always see exactly one checkbox.
- Shared DTOs (`MedicationDoseOccurrence`, `MedicationIntakeEvent`) now ship with rich metadata; contract tests validate shape alignment.

## Audit & Compliance Notes
- All destructive actions produce audit rows. Each row includes recipient info, actor, and a snapshot of the affected intake or medication.
- Overrides log both the override event and raise `overrideCount`, enabling downstream reporting on frequent overrides.
- `medication_intake_events` may grow quickly; consider a retention policy once production traffic provides real metrics.

## Operations Runbook
| Scenario | Steps |
|----------|-------|
| **Verify reset job executed** | Check logs for `[MedicationReset] Created next occurrence`. Optionally query `SELECT id, status, occurrence_date FROM medication_intakes WHERE medication_id = $1 ORDER BY occurrence_date DESC LIMIT 3;` to confirm tomorrow’s pending row exists. |
| **Reminder stuck pending** | Inspect `medication_reminder_events` for `status = 'pending'` with past `scheduled_for`. If the intake is already taken, run `cancel_pending_medication_reminders_for_intake(intake_id)` (SQL helper or service) and ensure `scheduleMedicationIntakeReminder` is invoked after resets. |
| **Audit verification** | `SELECT action, meta->>'medicationId', meta->>'intakeId' FROM audit WHERE action LIKE 'medication_%' ORDER BY id DESC LIMIT 10;` ensures hard deletes and overrides capture accurate metadata. |
| **Disable resets temporarily** | Set `MEDICATION_RESET_ENABLED=false`, restart the backend, and call `cancelMedicationRemindersForIntake` for occurrences that should not reschedule. Remember to re-enable once incident resolved. |

## Manual QA Checklist
1. Create a medication with two daily doses. Confirm the plan summary surfaces two checkbox chips and that toggling one updates the “Completed today” section.
2. Trigger an override by tapping a completed checkbox; accept the confirmation and verify the warning banner + `overrideCount` increment (visible via dev console or audit log).
3. Wait (or simulate via `node` REPL update) for the reset job to seed the next day. Ensure the plan refresh shows a new pending checkbox while history retains previous acknowledgements.
4. Delete the current day’s occurrence; a fresh pending occurrence should appear immediately with reminders rescheduled.
5. Run `DELETE /api/medications/:id` and confirm reminders, local notifications, and audit rows clear as expected.

## Next Steps
- Productionise the reset job with a dedicated scheduler once beta testing confirms cadence reliability.
- Monitor `medication_intake_events` growth; add pruning or cold-storage tooling if monthly growth exceeds expectations.
- Gather caregiver feedback on the checkbox + override flow before exposing to collaborators or adding multi-dose per day flexibility.
