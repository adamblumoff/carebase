# Carebase — Centralized Caregiver Hub

Carebase is a caregiver-first mobile app that pulls every stream of care information into one place. It keeps caregivers aligned on schedules, medications, care plans, and real-time updates so they can spend less time coordinating and more time caring.

## Developer docs

- Start here: `docs/README.md`
- Daily setup/run: `docs/development.md`
- System overview: `docs/architecture.md`
- API + ingestion: `docs/api.md`
- Infra/deploy: `docs/infra.md`
- Common workflows: `docs/workflows.md`
- Builds/releases: `docs/release.md`

## Key ideas

- Single source of truth for a care team’s daily tasks, notes, and documents.
- Clear, timely updates that reduce phone/email back-and-forth.
- Built for multi-platform access (iOS, Android, web) via Expo Router.
- Gmail-driven task ingestion that classifies appointments, bills, and medications via Vertex Gemini; drops very low-confidence items, flags medium confidence for review, and auto-approves only when signals are strong; ignored tasks are soft-deleted so they never resurrect on re-sync.
- Sender suppression: repeatedly ignoring tasks from the same sender domain auto-suppresses that domain (and you can manage suppressions in the Profile tab).
- Task detail actions: open source email (Gmail app/web) and calendar for appointments; quick edit sheet for title/type/description.

## Tech stack

- Expo SDK 54 (React Native 0.81, React 19, Hermes).
- Expo Router 6 on React Navigation 7.
- NativeWind (Tailwind 3.4) for styling; base styles in `global.css`.
- TypeScript 5.x with ESLint (flat) and Prettier.

## Getting started

1. Copy `.env.example` to `.env` and fill in values.
2. Install: `pnpm install`
3. Run API: `pnpm api:dev`
4. Run app: `pnpm start` (or `pnpm ios` / `pnpm android` / `pnpm web`)

See `docs/development.md` for the full, up-to-date setup checklist and platform-specific base URL tips.

## Environment variables

The canonical list (with notes) lives in `.env.example`. Key variables you’ll almost always need:

- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY`
- `EXPO_PUBLIC_API_BASE_URL` (and `DATABASE_URL` for the API)
- Google ingestion: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_STATE_SECRET`

## Project layout

- `app/` — routes/screens (Expo Router file-based).
  - `app/(tabs)/tasks/` — task list, detail sheet, and edit sheet trigger.
  - `app/(tabs)/connections.tsx` — Gmail connect/sync status.
- `components/` — shared UI building blocks.
- `assets/` — images, fonts, icons.
- `global.css` — global style tokens.
- Configs: `app.json`, `babel.config.js`, `metro.config.js`, `tailwind.config.js`.
