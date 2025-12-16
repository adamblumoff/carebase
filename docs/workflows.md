# Workflows

## Add a new screen/route

1. Create a file under `app/` (Expo Router file-based routing).
2. If it’s part of the tab UI, place it under `app/(tabs)/`.
3. Keep shared UI in `components/` (or a scoped folder under `components/`).

## Add shared UI

- Prefer small, composable components in `components/`.
- Keep styling in NativeWind classes; global tokens live in `global.css` and Tailwind config in `tailwind.config.js`.

## Add or change a tRPC procedure

1. Add a procedure in the appropriate router under `api/modules/**/router.ts`.
2. Ensure it is mounted in `api/trpc/root.ts`.
3. Use it in the app via `trpc.<router>.<procedure>.useQuery/useMutation/useSubscription`.

## Add a database change

1. Update `api/db/schema.ts`
2. Generate a migration: `pnpm db:generate`
3. Apply locally: `pnpm db:migrate`
4. Keep migration files in `drizzle/migrations/` committed and minimal.

## Work on Google ingestion

Key places:

- Google OAuth + helpers: `api/lib/google.ts`
- Watches + renewal/fallback: `api/lib/watch.ts` and server tickers in `api/index.ts`
- Webhook handler: `POST /webhooks/google/push` in `api/index.ts`
- Gmail sync: `api/modules/ingestion/router.ts`
- Calendar sync: `api/modules/ingestion/calendar.ts`
- Push-to-client events: `api/modules/ingestion/events.ts` + app toast in `app/_layout.tsx` (invalidates `tasks.listThin`, `tasks.upcoming`, and `tasks.stats`)
- Sender suppression: `api/modules/tasks/router.ts` (ignore hooks), `api/modules/sender-suppressions/router.ts` (tRPC), and the Profile UI entry to `app/(tabs)/suppressed-senders.tsx`.

Common gotchas:

- Changing env vars requires restarting both the API and Expo bundler.
- Emulator/device networking: `EXPO_PUBLIC_API_BASE_URL` must be reachable from that device.
