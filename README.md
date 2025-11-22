# Carebase — Centralized Caregiver Hub

Carebase is a caregiver-first mobile app that pulls every stream of care information into one place. It keeps caregivers aligned on schedules, medications, care plans, and real-time updates so they can spend less time coordinating and more time caring.

## Key ideas
- Single source of truth for a care team’s daily tasks, notes, and documents.
- Clear, timely updates that reduce phone/email back-and-forth.
- Built for multi-platform access (iOS, Android, web) via Expo Router.

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

## Environment variables
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`: Clerk publishable key for the app.
- `CLERK_SECRET_KEY`: Backend Clerk secret.
- `EXPO_PUBLIC_API_BASE_URL`: Base URL for the tRPC API (used by the Expo app). The app requests Clerk tokens using the `trpc` template, so configure that template in Clerk.
- `API_HOST` / `API_PORT`: Fastify server bind values.
- `DATABASE_URL`: Postgres connection string for Drizzle/pg.

## Project layout
- `app/` — routes/screens (Expo Router file-based).
- `components/` — shared UI building blocks.
- `assets/` — images, fonts, icons.
- `global.css` — global style tokens.
- Configs: `app.json`, `babel.config.js`, `metro.config.js`, `tailwind.config.js`.

## Next steps (suggested)
1. Define the first concrete user flows (e.g., daily task list, medication reminders) and the data model each requires.
2. Add state/data layer decisions: TanStack Query for server sync and optional Zustand for local state, wired to sample endpoints or mocked services.
3. Set up auth scaffolding (e.g., email/OTP) and environment handling with `.env.example`.
4. Add testing harness (Jest + React Native Testing Library) and wire `pnpm test`.
