# Lightning-Fast Sync Plan

Goal: “Mail hits inbox → task shows in app” with near-instant perceived latency.

## Backend tweaks
- **Cut push debounce**: reduce debounce on `/webhooks/google/push` from 2000ms → 100–200ms so sync starts almost immediately on push receipt.
- **Parallel fetch**: fetch Gmail messages in small concurrent batches (2–3) per push/poll to shave fetch time without hammering API limits.
- **Stay lean on push path**: keep push handler minimal; return 202 immediately; avoid heavy logging unless `DEBUG_PUSH_LOGS` is set.
- **Region alignment**: ensure API region matches Pub/Sub push region (currently us-west2) to minimize network latency.
- **Fallback poll**: keep 1-minute stale fallback as safety net; consider 30s if we can handle the load.

## Frontend/UX
- **Push-triggered refetch**: when backend records a push event, trigger `tasks.list` refetch immediately (can expose a lightweight `ingestionEvents.latest` query polled every few seconds or a subscription later).
- **Instant feedback**: toast/haptic “Syncing new email…” as soon as push is detected; “New task added” on completion.
- **Progress visibility**: show last push time / last sync time so users trust recency.
- **Fast first paint**: tasks cache is persisted to AsyncStorage and prefetch runs on sign-in/Home so the Tasks tab renders instantly from cache even after reload.

## Safety & limits
- Concurrency cap to 2–3 fetches to stay within Gmail read quotas and avoid 429s.
- Keep debounce >0 to avoid duplicate overlapping runs from burst pushes.
- Observability: log push latency (push received → sync start → sync end) when `DEBUG_PUSH_LOGS=true`.

## Open questions
1) How aggressive can we be on debounce? Is 100ms acceptable, or should we keep 200ms?
2) Parallel fetch: ok with 3 concurrent Gmail message.get calls per push?
3) Fallback poll interval: leave at 60s or lower to 30s?
4) Do you want a visible toast on push arrival, or only after tasks refresh?
5) Can we assume API will be deployed in a west-coast region (to match us-west2 Pub/Sub)?
6) Any concerns about slightly higher read volume on Gmail when parallelizing + faster poll fallback?

Next steps after answers: implement debounce reduction, parallel fetch, and optional frontend refetch/toast wiring on this branch.
