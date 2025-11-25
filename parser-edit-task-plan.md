# Parser + Inline Task Details Plan

## Goals
- Parse richer data from Gmail emails to populate appointment, bill, and medication fields already present in `tasks`.
- Present inline task details (expand-in-place) without new routes.
- Keep schema unchanged; favor incremental, safe parsing and UX.

## Backend parsing changes (Gmail)
- Switch Gmail fetch in `api/modules/ingestion/router.ts` from `metadata` to `full` for new/updated messages to access body + attachments (limit size; skip >200KB).
- Add per-type extractors (pure functions):
  - **Appointment**: prefer `.ics` attachment; fallback regex for date/time (`on <date> at <time>`), location lines, organizer/from. Set `startAt`, `endAt`, `location`, `organizer`, `status='scheduled'`.
  - **Bill**: extract primary amount + currency; `dueAt` from "due on/by" phrases; `vendor` from From-domain or body; `statementPeriod` from ranges; keep `amount`, `currency`, `vendor`, `dueAt`, `statementPeriod`.
  - **Medication**: `medicationName` (subject/body), `dosage` (mg/mcg/mL/tabs), `frequency` ("once daily", "q6h", BID), `route` (oral/topical/inhaled), `prescribingProvider` from signature. Leave `nextDoseAt` null for now.
- Populate existing columns only; no schema changes. Raise confidence when strong signals (e.g., ICS parsed) but cap at ~0.95; keep auto-approve threshold at 0.75.
- Store a trimmed plain-text `description` (~1–2 KB) from body for the detail view; keep `rawSnippet` untouched.
- Maintain idempotent upsert (createdById + sourceId) and current concurrency (3). Add guard to ignore oversized bodies.
- Add optional debug logging of parsed fields behind `DEBUG_PARSE` env flag.

## Frontend inline details
- In `app/(tabs)/tasks/index.tsx`, add per-row expand/collapse: tapping a task reveals details within the same card (no navigation change).
- Detail presenter per type:
  - **Appointment**: date/time range, location, organizer, confidence badge, `sourceLink` button (open email).
  - **Bill**: amount+currency, vendor, due date, statement period, source link.
  - **Medication**: medication name, dosage, frequency, route, prescribing provider.
  - Fallback: description + sender + snippet when specific fields absent.
- Show placeholders when fields missing; avoid empty labels. Keep accessibility/tap affordances.
- Reuse `tasks.list` payload; ensure TRPC types expose new fields (widen select if needed).

## Testing & rollout
- Add unit tests for extractors with fixtures (appointment, bill, medication, generic) near parser code.
- Manual QA with sample emails to confirm fields and inline rendering.
- Observability light-touch: watch confidence distributions and ingestion logs under `DEBUG_PARSE`.

## Open choices (to confirm quickly)
- Truncation length for stored description (proposed 1–2 KB plain text).
- Fallback currency when none parsed (default USD).
