# Realtime Plan Item Updates

Goal: deliver realtime updates for plan data (appointments & bills) with minimal payloads, starting with the plan screen and covering all mutation sources (local actions, collaborators, Google sync). The realtime pipeline must still fallback to periodic refresh when sockets lag or disconnect.

---

## Step 0 – Recon & Guardrails
- [x] Trace current realtime flow (`backend/src/services/realtime.ts`, `planEvents` helpers, Socket.IO usage in mobile) to document what events already exist (`plan:update`) and when they fire.
- [x] Confirm `ensureRealtimeConnected` behaviour and polling cadence so the fallback refresh keeps working.
- [x] List every code path that mutates appointments/bills:
  - REST controllers (`backend/src/controllers/api/appointments.ts`, `bills.ts`)
  - Services invoked by collaborators (`.../services/appointmentService.ts`, etc.)
  - Google sync push/pull pipelines (`googleSync/syncOperations.ts`)
- [x] Define the minimal delta payload we need (e.g. `{ itemType: 'appointment'|'bill', itemId, action: 'created'|'updated'|'deleted', version }`) and how to extend later for other screens.

## Step 1 – Backend Event Publisher
- [x] Add a typed event emitter helper (e.g. `PlanRealtimePublisher`) that wraps the existing Socket.IO emitter and exposes `emitItemMutation(userId, delta)` alongside the existing `emitPlanUpdate`.
- [x] Ensure the helper deduplicates rapid-fire events (set-level throttle within the same event loop tick) to avoid flooding clients when a service writes multiple rows per operation.
- [x] Write lightweight unit tests for the publisher to confirm emitted payloads.

## Step 2 – Hook Up Mutation Sources
- [x] REST handlers: after successful create/update/delete of appointments/bills, publish the relevant delta + new plan version. Reuse shared helper so both owner and collaborator routes hit it.
- [x] Google sync: surface mutations from push/pull ops (the ones that currently schedule a plan refresh) and emit derived deltas before queueing the sync. Make sure deltas fire for both new items and deletions propagated from Google.
- [x] Service-level guard: if we cannot compute an exact delta (e.g. bulk migration), emit a generic `planVersionBumped` event so clients can fallback to fetching.
- [x] Extend integration tests (existing google sync + REST tests) to assert that the mocked realtime emitter receives the expected deltas.

## Step 3 – Socket Payload & Types
- [x] Define a new Socket.IO event name (e.g. `plan:item-mutated`) and payload interface in `shared/`.
- [x] Update backend emitter to broadcast on this channel.
- [x] Ensure the existing `plan:update` event continues to fire for backwards compatibility until we confirm all clients upgraded.

## Step 4 – Mobile Client (Plan Screen)
- [x] Update the realtime utility (`mobile/src/utils/realtime.ts`) to subscribe to `plan:item-mutated`.
- [x] Thread delta events through `PlanProvider`:
  - Apply in-memory updates to `plan` state when possible (create/update/delete).
  - Track `latestVersion` using the delta payload; when out-of-order or missing data, trigger a `refresh({ silent: true })`.
- [x] Add Vitest coverage for reducer-style helpers to verify local state patches, including edge cases (unknown item -> fallback refresh).
- [x] Verify manual fallback (if socket is disconnected or mutation fails to apply, periodic poll still refreshes the plan).

## Step 5 – QA & Latency Checks
- [ ] Manual smoke: run backend + mobile, create/update/delete appointments and bills, ensure changes appear instantly on another device/emulator without manual refresh.
- [ ] Simulate Google-originated edits (use existing sync tests or manual Google calendar change) and confirm realtime delta arrives.
- [ ] Validate logs/metrics to ensure we aren’t spamming events (watch `auth.clerk.socket`, new `plan.delta.*` counters).

## Step 6 – Roll Forward & Future Expansion
- [x] Document the new event contract (`docs/realtime.md`).
- [ ] Once plan screen is stable, replicate the delta handling for settings/collaborator screens (follow-up PR).
- [ ] When ready, retire legacy `plan:update` broadcast or repurpose it as the catch-all fallback event.
