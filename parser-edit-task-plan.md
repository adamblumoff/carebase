# Parser + Inline Task Details Plan

## What shipped (tasks ingestion + detail/edit UX)
- Gmail ingestion pulls full messages, parses body/ICS to fill appointments/bills/meds, and skips messages >200KB.
- Confidence gates: <60% dropped; 60–<80% marked `pending` for review; ≥80% auto-approved.
- Review actions: approve keeps the task; ignore now deletes the task.
- Appointment actions: open in Gmail or Calendar (Google Calendar intents on Android / Google/Apple Calendar on iOS when available).
- Task detail is a modal sheet; edit sheet handles title/type/description only.

## Backend parsing & thresholds
- `api/modules/ingestion/router.ts` now uses `format=full` and per-type extractors (appointment/bill/med).
- Populates description snippet, amount/vendor/due dates, medication fields, start/end/location when available; caps confidence at 0.95.
- Idempotent upsert by (createdById, sourceId); skips low-confidence and oversized messages.

## UI/UX
- Tasks list opens a full-screen detail sheet; appointment cards include Gmail/Calendar buttons.
- Edit task sheet (from card edit icon) lets users change title, description, and type; save is confirmed via alert.
- Keyboard-aware scrolling keeps inputs visible while editing; transparent dimmers on sheets.

## Docs/tips
- Restart the API after pulling to pick up the new `tasks.updateDetails` tRPC route.
- On iOS, opening Gmail/Calendar is best-effort via URL schemes; falls back to web if the app isn’t installed.
