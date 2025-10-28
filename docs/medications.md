# Medications Feature – Requirements & Flows

_Drafted October 28, 2025_

## Scope Summary
- Introduce owner-managed medications with fixed daily dose schedules.
- Persist inventory details (quantity on hand, refill threshold, preferred pharmacy) to project refill dates.
- Deliver Expo push notifications at scheduled dose times, nag every 120 minutes until acknowledged, send an end-of-day reminder, and continue daily notifications until the dose is marked taken or skipped.
- Support both manual form entry and OCR-based ingestion of prescription labels; collaborators receive read-only access.

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

State machine sketch:

```
pending → (ack taken) → taken (stop)
pending → (ack skipped) → skipped (stop)
pending → (EOD job) → overdue → (daily reminder) → overdue (loop) until ack
```

## Permissions
- Owners may create, update, archive medications, doses, and intakes.
- Collaborators (contributors) receive read-only API responses; write attempts return HTTP 403.
- Backend enforcement via owner-scoped guard that references `CollaboratorRole`.

## OCR Workflow
1. Owner launches “Scan Prescription” from mobile.
2. Photo uploaded to existing `/api/upload/photo` endpoint with `intent=medication`.
3. Backend routes image to medication label parser:
   - Extracts key/value pairs (med name, dosage, instructions, quantity, refills, prescriber).
   - Returns structured draft payload.
4. Mobile surfaces editable confirmation form; final “Save” invokes `POST /api/medications`.
5. Unrecognized fields fall back to manual entry.

## API Surface (Draft)
- `POST /api/medications` – create medication + schedule.
- `GET /api/medications` – list with doses, next intakes, refill projection.
- `GET /api/medications/:id`
- `PATCH /api/medications/:id`
- `PATCH /api/medications/:id/archive`
- `POST /api/medications/:id/doses`
- `PATCH /api/medications/:id/doses/:doseId`
- `POST /api/medications/:id/intakes` – mark taken/skipped.
- `POST /api/upload/medication-label` – specialized OCR (tbd, may reuse existing upload with query param).

## Non-Goals (Phase 1)
- Analytics dashboards (missed-dose trends, streaks).
- SMS/email notification channels.
- Collaborator editing rights or approval workflows.
- Complex schedules (tapers, every X hours patterns, PRN logging).
- HIPAA-specific audit trail enhancements beyond existing standards.

## Outstanding Questions
- Confirm target timezone per recipient; fallback to account default if missing.
- Verify Expo push quota for worst-case nag loop across user base.
- Determine storage for prescription images (reuse `uploads/` bucket?) and retention timeline.

## Next Steps
- TODO: Schedule product/compliance review of reminder cadence and stored fields.
- TODO: Align with ops/support on escalation messaging and runbook updates.
- TODO: Finalize acceptance criteria before beginning schema work (Milestone 1).
