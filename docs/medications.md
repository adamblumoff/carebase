# Medications Feature – Requirements & Flows

_Drafted October 28, 2025_

## Scope Summary
- Owners can create, edit, delete, and archive medications with fixed daily dose schedules. Collaborators continue to receive read-only access on web + mobile.
- Each medication tracks inventory metadata (quantity on hand, refill threshold, preferred pharmacy) to project refill dates that surface in the plan payload.
- Deliver Expo push notifications at scheduled dose times, nag every 120 minutes while doses remain pending, follow up with an end-of-day reminder, and continue daily escalations until the intake is marked taken or skipped. Mobile now also schedules a local fallback reminder so the user still sees a prompt if push delivery fails.
- Manual and OCR-based ingestion both land on the plan screen’s medication form. The backend returns structured drafts from `/api/upload/photo?intent=medication` which the mobile client pre-fills for confirmation.

## Domain Entities

```
Recipient 1─* Medication 1─* MedicationDose
                     |             |
                     |             └─* MedicationIntake
                     |
                     └─1 MedicationRefillProjection (materialized)
```

### Medication
- `name` (string)
- `strengthValue` (decimal) + `strengthUnit` (enum: mg, mcg, mL, tablet, capsule, patch, other)
- `form` (enum/string: tablet, liquid, injection, topical, other)
- `instructions` (markdown-safe string)
- `notes` (free-text)
- `prescribingProvider` (string)
- `startDate` / `endDate` (date; end optional)
- `quantityOnHand` (integer; optional for OCR fallback)
- `refillThreshold` (integer — trigger when quantity <= threshold)
- `preferredPharmacy` (string)
- `ownerId` (FK to collaborators table)
- Timestamps (`createdAt`, `updatedAt`, `archivedAt`)

### MedicationDose
- `label` (string e.g., “Morning”)
- `timeOfDay` (time without date)
- `timezone` (IANA string, defaults to recipient timezone)
- `reminderWindowMinutes` (default 120)
- `isActive` (boolean)

### MedicationIntake
- `scheduledFor` (timestamptz)
- `acknowledgedAt` (timestamptz nullable)
- `status` enum (`pending`, `taken`, `skipped`, `expired`)
- `actorUserId` (nullable FK, populated when acknowledgement occurs)
- Optional `doseId` to link to repeating schedule template.

### MedicationRefillProjection
- Derived view/table storing `expectedRunOutOn` based on quantity, doses per day, and adherence streak.

## Reminder Cadence
1. **Initial Reminder** – Fire at `scheduled_for` timestamp.
2. **Nag Loop** – Repeat every 120 minutes until `MedicationIntake.status` becomes `taken` or `skipped`. Respect waking hours (7am–10pm local) to avoid overnight nags.
3. **End-of-Day Summary** – If still pending by 9pm local, send a “still outstanding” notification.
4. **Next-Day Escalation** – Each morning at 9am, re-emphasize missed doses until acknowledged; ingest acknowledgement to cancel future repeats.
5. **Local Fallback (mobile)** – When the plan loads, the mobile client mirrors the next few intakes with local notifications (6‑hour window, two-minute catch-up for overdue doses) so the user still receives a reminder if Expo push fails or the device is offline. Local notifications are marked with `data.carebase.localMedicationReminder = true` and cleared whenever medication data refreshes.

State machine sketch:

```
pending → (ack taken) → taken (stop)
pending → (ack skipped) → skipped (stop)
pending → (EOD job) → overdue → (daily reminder) → overdue (loop) until ack
```

## Permissions
- Owners may create, update, archive medications, doses, and intakes.
- Owners may permanently delete medications and individual intake rows; collaborators remain read-only.
- Collaborators (contributors) receive read-only API responses; write attempts return HTTP 403.
- Backend enforcement via owner-scoped guard that references `CollaboratorRole`.

## OCR Workflow
1. Owner launches “Scan Prescription” from the plan screen (camera intent `medication`).
2. Mobile uploads the photo to `/api/upload/photo?intent=medication&timezone=<IANA>` as multipart form data.
3. Backend extracts OCR text, runs `extractMedicationDraft`, and returns `{ medicationDraft, ocr.preview }` without writing storage objects. Failures fall back to manual entry with an inline toast.
4. Mobile opens the medication form pre-filled with the draft. Users can adjust fields before submitting `POST /api/medications`.
5. When the OCR draft is dismissed or saved, route params clear so subsequent launches return to manual entry.

## Audit & Hard Delete Behavior
- `DELETE /api/medications/:id` removes the medication, all doses, intakes, refill projections, queued reminders, and OCR drafts in a single transaction. The response includes `{ deletedMedicationId, auditLogId }`.
- `DELETE /api/medications/:id/intakes/:intakeId` removes an individual intake (for accidental “Mark taken” taps) and returns the hydrated medication payload plus `{ deletedIntakeId, auditLogId }`.
- Both operations create audit rows (`medication_deleted`, `medication_intake_deleted`) containing the acting user, recipient, and a snapshot of the removed data to support compliance reviews.
- Mobile surfaces confirmation dialogs before issuing destructive requests and refreshes plan state using the response payloads.

## API Surface (Draft)
- `POST /api/medications` – create medication + schedule.
- `GET /api/medications` – list with doses, next intakes, refill projection.
- `GET /api/medications/:id`
- `PATCH /api/medications/:id`
- `DELETE /api/medications/:id`
- `PATCH /api/medications/:id/archive`
- `POST /api/medications/:id/doses`
- `PATCH /api/medications/:id/doses/:doseId`
- `DELETE /api/medications/:id/doses/:doseId`
- `POST /api/medications/:id/intakes` – mark taken/skipped (mobile uses `status=taken` for “Mark now” with a generated `scheduledFor`).
- `PATCH /api/medications/:id/intakes/:intakeId` – update intake status (e.g., mark skipped).
- `DELETE /api/medications/:id/intakes/:intakeId`
- `POST /api/medications/:id/refill` / `DELETE /api/medications/:id/refill` – set or clear projections.
- `/api/upload/photo?intent=medication` – existing upload endpoint with `intent`/`timezone` query parameters.

## Non-Goals (Phase 1)
- Analytics dashboards (missed-dose trends, streaks).
- SMS/email notification channels.
- Collaborator editing rights or approval workflows.
- Complex schedules (tapers, every X hours patterns, PRN logging).
- HIPAA-specific audit trail enhancements beyond existing standards.

## Outstanding Questions
- Long-term retention policy for OCR images (currently skipped because medication intent does not persist the raw text file; confirm compliance expectations).
- Decide whether local reminders should respect per-medication quiet hours in future phases.

## Next Steps
- Milestone 5 QA: run backend and contract suites, validate medication flows on physical devices (OCR, intake, notification handshake), document any manual verification steps, and confirm delete endpoints write audit trail entries + cancel reminders.
- Gather feedback from internal testers on reminder cadence/local fallback usefulness before enabling the production feature flag.
