# Data Layer Wiring Plan (app side)

## Goals
- Add a typed tRPC client + TanStack Query provider to the Expo app.
- Authenticate API calls with Clerk-issued bearer tokens.
- Ship a minimal tasks screen that exercises queries (and optionally create mutation).

## Approach
1) Client plumbing
   - Create `app/(lib)/trpc/client.ts` exporting `trpc` helper, `queryClient`, and `trpcClient` factory.
   - Use `httpBatchLink` pointing at `${process.env.EXPO_PUBLIC_API_BASE_URL}/trpc`.
   - Inject `Authorization: Bearer <token>` via Clerk `getToken({ template: 'trpc' })`; handle null tokens gracefully.
   - Keep JSON transformer; add basic `onError` logging.
   - Set Query defaults: `staleTime ~30s`, `retry: 1` for queries, disable suspense.

2) Provider placement
   - Wrap `QueryClientProvider` + `trpc.Provider` inside `app/_layout.tsx`, nested under `ClerkProvider` but above `Slot` so all routes share context.
   - Provide a fallback while auth is loading (already handled in `AuthGate`).

3) Routes to exercise data
   - Add `app/tasks/index.tsx` using `trpc.tasks.list.useQuery()` to render task title/status with loading/error states.
   - Add an “Add task” flow using `trpc.tasks.create.useMutation()` with optimistic append + rollback on failure; replace optimistic row with server payload on success.
   - Link from `app/index.tsx` to `/tasks`.

4) Env & config
   - Add `.env.example` entries: `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `DATABASE_URL`.
   - Document dev values in `README` and mention device testing needs (tunnel URL for Expo Go).

5) Testing & DX
   - Later: add Jest + RNTL + msw to mock tRPC; first test for tasks list happy/error.
   - Consider `invalidateQueries` helpers for mutations; keep batch link to reduce round-trips.

## Open questions
- Optimistic updates: do them now for task creation (append, rollback on error, replace with server payload on success).
- Clerk token template: use dedicated `trpc` template via `getToken({ template: 'trpc' })` for API calls.
- Extra headers: none for now; add tracing/version headers later if/when backend consumes them.
