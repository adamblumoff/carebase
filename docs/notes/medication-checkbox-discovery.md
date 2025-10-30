# Medication Checkbox Discovery Notes — October 30, 2025

## Stakeholder Alignment
- Audience remains caregivers (plan owners). Collaborators stay read-only for now.
- Desired flow: one checkbox per dose per day. A second tap should warn the caregiver but allow an override in case the dose truly happened again.
- No notes/annotations in v1; revisit after we ship the core experience.
- Daily reset should occur **one hour before** the next scheduled occurrence (e.g., 8:00 AM dose resets at 7:00 AM local to the dose).
- Preserve redundant timestamps for compliance. Even if the UI surfaces a single checkbox, the backend must keep all take/undo/override events.

## Reminder Inventory
- Backend currently seeds Expo push reminders when intakes are created; reminders cancel when `recordMedicationIntake` sets `acknowledgedAt`.
- Mobile mirrors the next few pending intakes into local notifications (6‑hour window, 2‑minute catch-up). Will need to update this flow to look at daily occurrences instead of multiple raw intakes.
- There is no dedicated scheduler module yet; the reset cadence will require a new worker or cron task.

## Compliance / Audit Considerations
- Audit trail today captures delete events. Checkbox redesign must log:
  - initial acknowledgement time,
  - override confirmations (with incremented counter),
  - skips/undos.
- Need to ensure auditors can reconstruct all historical timestamps even after daily reset.

## Open Points (to address during implementation)
- Timezone conversion edge cases (DST transitions) when computing “one hour before.”
- Storage growth for `medication_intake_events`; plan retention strategy once the feature proves out.
- Future collaborator support: design the data model to store `actorUserId` so we can enable this later without breaking history.
