# Carebase — Centralized Caregiver Hub

Carebase is a caregiver-first mobile app that pulls every stream of care information into one place. It keeps caregivers aligned on schedules, medications, care plans, and real-time updates so they can spend less time coordinating and more time caring.

## Key ideas

- Single source of truth for a care team’s daily tasks, notes, and documents.
- Clear, timely updates that reduce phone/email back-and-forth.
- Built for multi-platform access (iOS, Android, web) via Expo Router.
- Gmail-driven task ingestion that classifies appointments, bills, and medications via Vertex Gemini; drops very low-confidence (<60%) emails, flags medium (60–<80%) for review, auto-approves ≥80%; ignored tasks are soft-deleted so they never resurrect on re-sync.
- Task detail actions: open source email (Gmail app/web) and calendar for appointments; quick edit sheet for title/type/description.

## Tech stack

- Expo SDK 54 (React Native 0.81, React 19, Hermes).
- Expo Router 6 on React Navigation 7.
- NativeWind (Tailwind 3.4) for styling; base styles in `global.css`.
- TypeScript 5.x with ESLint (flat) and Prettier.

## Getting started

1. Copy `.env.example` to `.env` and fill in the values (Clerk keys, database URL, API host/port, `EXPO_PUBLIC_API_BASE_URL`).
2. Install dependencies: `pnpm install` (corepack recommended).
3. Run the API: `pnpm api:dev` (expects `DATABASE_URL`); default host/port come from `.env`.
4. Run the app: `pnpm start` then choose iOS, Android, or Web (or use `pnpm ios` / `pnpm android` / `pnpm web`). Ensure `EXPO_PUBLIC_API_BASE_URL` points to the reachable API URL for your simulator/device (e.g., `http://localhost:3000` for web/simulator or your tunnel URL for Expo Go).
5. Lint/format: `pnpm lint` to check, `pnpm format` to fix.
6. Performance defaults: query cache persists to AsyncStorage and hydrates on startup; Home and root layouts prefetch tasks (and filters) plus recent ingestion events so the Tasks tab should render instantly from cache and refresh in the background.

## Environment variables

- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`: Clerk publishable key for the app.
- `CLERK_SECRET_KEY`: Backend Clerk secret.
- `EXPO_PUBLIC_API_BASE_URL`: Base URL for the tRPC API (used by the Expo app). The app requests Clerk tokens using the `trpc` template, so configure that template in Clerk.
- `EXPO_PUBLIC_API_BASE_URL_PROD`: Optional production base URL (used when `NODE_ENV=production`).
- `EXPO_PUBLIC_GOOGLE_REDIRECT_URI` / `_PROD`: OAuth redirect URI the Expo app passes when connecting Google (must be authorized in your Google OAuth client).
- `API_HOST` / `API_PORT`: Fastify server bind values.
- `PORT`: If set by the host (e.g., Railway), the API binds to this instead of `API_PORT`.
- `DATABASE_URL`: Postgres connection string for Drizzle/pg.
- `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW`: Rate limiting settings.
- `POSTHOG_API_KEY` / `POSTHOG_HOST`: Backend PostHog ingestion (optional; required if you want server events).
- Google ingestion: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (needed for Gmail sync). Use `prompt=consent&access_type=offline` in the OAuth flow to ensure a refresh token.
- Vertex AI classification: `GOOGLE_VERTEX_PROJECT_ID`, `GOOGLE_VERTEX_LOCATION` (default `us-central1`). Use ADC/service account (no secrets in git).
- Pub/Sub push: `GOOGLE_PUBSUB_PROJECT`, `GOOGLE_PUBSUB_TOPIC_DEV/PROD`, `GOOGLE_WEBHOOK_URL(_PROD)`, `GOOGLE_PUBSUB_VERIFICATION_TOKEN`.

## Project layout

- `app/` — routes/screens (Expo Router file-based).
  - `app/(tabs)/tasks/` — task list, detail sheet, and edit sheet trigger.
  - `app/(tabs)/connections.tsx` — Gmail connect/sync status.
- `components/` — shared UI building blocks.
- `assets/` — images, fonts, icons.
- `global.css` — global style tokens.
- Configs: `app.json`, `babel.config.js`, `metro.config.js`, `tailwind.config.js`.

## Next steps (suggested)

1. Define the first concrete user flows (e.g., daily task list, medication reminders) and the data model each requires.
2. Add state/data layer decisions: TanStack Query for server sync and optional Zustand for local state, wired to sample endpoints or mocked services.
3. Set up auth scaffolding (e.g., email/OTP) and environment handling with `.env.example`.
4. Add testing harness (Jest + React Native Testing Library) and wire `pnpm test`.
