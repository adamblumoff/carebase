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
1. Install dependencies: `pnpm install` (corepack recommended).
2. Run the app: `pnpm start` then choose iOS, Android, or Web (or use `pnpm ios` / `pnpm android` / `pnpm web`).
3. Lint/format: `pnpm lint` to check, `pnpm format` to fix.

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

