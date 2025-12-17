# Carebase Roadmap (Caregiver Burnout Reduction)

## Product goal

Help non-professional, middle-age family caregivers reduce burnout by:

- Aggregating “care chaos” (email, appointments, bills, meds, random requests) into one central hub.
- Converting that information into the easiest possible next action (approve/ignore/assign/snooze/do).
- Making multi-caregiver coordination feel effortless (shared truth, clear ownership, fewer handoff mistakes).

## Current baseline (today)

- Primary entity is `tasks` with types: `appointment | bill | medication | general`.
- Gmail + Calendar ingestion creates tasks with confidence routing:
  - Drop very low confidence.
  - `reviewState=pending` for medium confidence.
  - Auto-approve only when strong.
  - Ignored tasks are tombstoned (`reviewState=ignored`) and do not resurrect on re-sync.
- Sender suppression reduces repeated junk by domain.
- App already supports:
  - All / Upcoming / Review task views.
  - Connect Google and manual sync.
  - Push-triggered background refresh + toast.

## Key constraints (agreed)

- “Everything is tasks” (no separate meds/appointments objects yet).
- Multiple Gmail connectors must be supported, but ingestion defaults to the Primary inbox only.
- Typical household = one care recipient, but multiple caregivers collaborating.
- For now, each caregiver belongs to exactly one care recipient.

## Principles (how we build)

- Default UI answers: “What do I do next?” not “What data do I have?”
- A caregiver should be able to dump information in and decide later (“review pile” always exists).
- Collaboration must be safe-by-default:
  - roles/permissions
  - clear ownership
  - reversible actions
  - audit trail for “who changed what”
- Prefer incremental schema changes that preserve existing ingestion behavior.

## Roadmap

### P0 (next 2 weeks): Shared hub + shared review + ownership

**Outcome:** A household can operate out of one shared task stream for one care recipient.

1) Care recipient workspace (shared scope)
- Introduce a “care team” membership model so multiple caregivers can collaborate on a single care recipient.
- Update task list predicates to be “tasks for recipient + visible to my team” rather than “tasks I created”.
- Keep `tasks.createdById` as attribution (“who added this”), not as the partition key.

2) Assignments (single owner, optional)
- Make “Assign to…” a first-class action in the Tasks UI.
- Use the existing `task_assignments` table to represent ownership (start with 0–1 assignee per task).
- Add quick filters:
  - “Assigned to me”
  - “Unassigned”

3) Team Review Inbox (built on existing Review tab)
- Review actions: `Approve`, `Ignore`, `Assign`, `Snooze`.
- Display a simple “why” summary for non-professional caregivers:
  - confidence %
  - source sender/domain
  - 1–2 extracted fields (date/vendor/provider) when available

4) “Primary Gmail” (but allow more connectors)
- Keep onboarding default to one “Primary” Gmail connection for the household.
- Allow other caregivers to connect their own Gmail later (“Add another inbox”).
- In the Connections UI: show which inbox is Primary + what’s being ingested from each.
- Limit ingestion to the Primary inbox by default (non-primary inboxes connect for later enablement).

5) Cross-connector dedupe guardrails
- Prevent duplicate tasks when multiple caregivers connect inboxes that receive the same messages.
- Add a stable external identity for ingested items (Gmail message id, Calendar event id) and dedupe within a care recipient scope.

**Acceptance criteria**
- Two caregivers invited to the same care recipient see the same Tasks list and Review queue.
- One caregiver can approve/ignore/assign; the other immediately sees the updated state.
- Adding a second Gmail connector does not create obvious duplicates for shared emails.

**Suggested schema/API deltas (minimal)**
- Add `care_recipient_memberships`:
  - `careRecipientId`, `caregiverId`, `role (owner|viewer)`, `isPrimary`, timestamps
- Enforce “exactly 1” recipient per caregiver (unique index on `caregiverId` in memberships).
- Add `tasks.externalId` (text, nullable) and `tasks.externalProvider`/reuse `provider`:
  - Unique on `(careRecipientId, provider, externalId)` when `externalId` is present.
- Add `tasks.assigneeId` (uuid, nullable) OR enforce 0–1 row in `task_assignments` for now.
- Update ingestion to attach a `careRecipientId` reliably:
  - default to the caregiver’s primary recipient membership
  - if none, route to a “needs setup” state (avoid silent misfiling)
- Only ingest from sources marked Primary by default (future: “enable ingestion” toggle per source).

### P1 (2–6 weeks): Today view + handoffs + audit trail

**Outcome:** The app becomes a daily operating system, not just a list.

1) Today screen (default home)
- Sections (ordered):
  - Needs review
  - Due today (bills + time-sensitive)
  - Upcoming (7 days)
  - Assigned to me
  - Recently completed (last 24h)
- One-tap actions:
  - done / undo
  - assign
  - snooze
  - open source email/calendar

2) Handoff notes (shift-change friendly)
- A lightweight “Handoff” note pinned to Today:
  - “What happened today”
  - “What to watch for”
  - “Open loops”
- Optional per-day notes; editable by editors/admins.

3) Audit trail (“what changed, by who”)
- A `task_events` table capturing:
  - status/review changes, assignment changes, edits
  - actor caregiver id
  - timestamp
- Minimal UI:
  - “History” section in Task Details

4) Notifications (low scope)
- Push notifications for:
  - “Task assigned to you”
  - “Task needs review” (daily digest, not spammy)
  - “Appointment today” (morning-of)

**Acceptance criteria**
- A caregiver can open the app and finish the top 3 actions in <30 seconds.
- Handoff reduces repeated texting (“what’s going on?”) inside the family.

### P2 (6–12 weeks): Care Profile hub + document-first intake + export

**Outcome:** Carebase becomes the “single source of truth” beyond tasks.

1) Care Profile hub (still tasks-first, but structured reference)
- Tabs/sections:
  - “Basics” (name, DOB optional, baseline notes)
  - “Emergency card” (allergies, meds list snapshot, contacts)
  - “Providers & pharmacies”
  - “Insurance” (cards/photos + notes)

2) Document vault + extraction-to-tasks
- Upload photos/PDFs, auto-tag, and optionally extract tasks:
  - discharge instructions → follow-up tasks
  - bills → due date + amount tasks
  - appointment printouts → calendar-like tasks

3) Clinician-ready export
- “Weekly summary” export (PDF/share) based on tasks + handoff notes:
  - upcoming appointments
  - meds-related tasks
  - recent changes + issues

## Metrics (what “valuable” means)

Track per care recipient:

- Median time from ingestion → approved/ignored/assigned.
- % of tasks assigned (ownership clarity).
- Count of pending review items older than 48 hours.
- Weekly active caregivers per recipient (collaboration).
- “Reopen rate” (tasks marked done then undone quickly) as a proxy for confusion.

## Risks & mitigations

- **Misfiling tasks to the wrong recipient:** require a primary recipient membership before ingestion writes tasks; otherwise route to a setup-required state.
- **Notification fatigue:** start with digest + only assignment pings; keep opt-outs.
- **Privacy + access control complexity:** keep roles simple early (`admin|editor|viewer`) and gate destructive actions.
- **Dedupe edge cases:** dedupe by stable external IDs first; add “merge duplicates” as a manual escape hatch later.

## Open questions (needs product decisions)

1) Care recipient membership: enforce exactly one care recipient per caregiver (decided).
2) Ownership + permissions: one owner who can edit; viewers are read-only (decided).
3) Multiple Gmail connectors: ingest only from the Primary inbox by default (decided).
