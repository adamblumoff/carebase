# Carebase – Detailed Reference

This guide captures the full architecture, workflows, and conventions for the Carebase monorepo. The top-level [README](../README.md) stays intentionally lightweight; come here when you need the specifics.

---

## 1. Repository Layout

```
carebase/
├── backend/                # Express + TypeScript API
│   ├── src/
│   │   ├── auth/           # Passport + mobile token helpers
│   │   ├── controllers/    # REST handlers (business logic)
│   │   ├── db/             # Query helpers + pg client
│   │   ├── middleware/     # Express middleware
│   │   ├── routes/         # Express routers
│   │   ├── services/       # Parser, Google sync, storage, email
│   │   └── server.ts       # App bootstrap
│   ├── scripts/            # DB utilities (migrations, docs)
│   └── package.json
├── mobile/                 # Expo React Native client
│   ├── App.tsx             # Bootstrap, deep-link wiring
│   ├── src/
│   │   ├── api/            # Axios client + feature API wrappers
│   │   ├── auth/           # Auth context, helpers
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── navigation/
│   │   ├── screens/
│   │   ├── ui/             # Theme + Toast providers
│   │   └── utils/          # realtime + plan event bus
│   └── package.json
├── shared/                 # Cross-runtime TypeScript types
├── tests/                  # API contract tests (pg-mem + supertest)
├── scripts/                # Repo-level helpers (env swaps, backend launcher)
└── docs/                   # This file + generated API docs
```

---

## 2. Environment Management

### Backend
- Loads **only** `.env.<env>` and `.env.<env>.local` (in that order). `<env>` comes from `CAREBASE_ENV` (fallback `NODE_ENV`, default `development`).
- Convenience:
  - `npm run dev:backend` → `CAREBASE_ENV=development`
  - `npm run dev:backend:prod` → `CAREBASE_ENV=production`
- Templates: `env.development.local.example`, `env.production.local.example`.

### Mobile (Expo)
- Expo always prefers `.env.local`. Use the helper scripts to swap values:
  - `npm run env:mobile:dev`
  - `npm run env:mobile:prod`
- After swapping, restart Expo with `npx expo start --clear`.
- Templates live in `mobile/.env.*.example`.

### Quick Reference
```bash
npm run dev:backend          # API vs ngrok
npm run dev:backend:prod     # API vs carebase.dev
npm run env:mobile:dev       # Expo → ngrok
npm run env:mobile:prod      # Expo → carebase.dev
```

---

## 3. Backend Architecture

### Auth & Sessions
- Google OAuth via Passport (`backend/src/auth/passport.ts`).
- Web login persists a session (express-session); mobile sign-in trades the OAuth code for a JWT via `issueMobileLoginToken`.
- `mobile/src/App.tsx` handles the deep-link containing `loginToken` and then exchanges it through `/api/auth/mobile-login`.

### Request Pipeline
1. `server.ts` loads env, mounts middleware (JSON, session, bearer-token attach) and registers routers via `routes/registry.ts`.
2. API routers delegate to controllers in `backend/src/controllers` for business logic.
3. Database queries now live under `backend/src/db/queries/` (with a barrel file at `backend/src/db/queries.ts`) and share the same connection pool exported by `db/client.ts`.

### Email Ingestion
- Postmark webhook hits `/webhook/inbound-email`.
- `parser.ts` classifies text as bill/appointment/noise and extracts structured payloads.
- Parsed appointments/bills are stored under `appointments`/`bills` tables; `touchPlanForUser` bumps plan version + realtime notifications.

### Collaborators
- `/api/collaborators` handles listing/inviting/accepting.
- Acceptance now enforces email match (`emailsMatch`) to prevent the owner from redeeming invites.
- `/collaborators/accept` serves a static HTML landing page (no EJS dependencies remaining).

### Google Calendar Sync
- OAuth endpoints at `/api/integrations/google/*`.
- Tokens are stored in `google_credentials`; per-item sync metadata in `google_sync_links`.
- `services/googleSync.ts` manages job scheduling, de-bounces syncs, and reconciles remote vs local changes.
- Mobile Settings screen surfaces status, manual sync, and disconnect actions.

### Realtime & Versioning
- Socket.io pushes `plan:update` events on plan writes (`services/realtime.ts`).
- Mobile listens via `utils/planEvents` and refetches the plan when notified.
- Polling fallback: `/api/plan/version` returns owner plan version + timestamp regardless of collaborator.

### Removed Web Stack
- Legacy EJS routes/views have been removed (no `/plan`, `/settings`, etc.). Root `/` now returns JSON `{status:'ok'}`.

---

## 4. Mobile Architecture

### App Bootstrap
- `App.tsx` wires providers (Theme, Auth, Toast), handles deep links (`carebase://`), and boots navigation.
- Deep links: invite acceptance (`carebase://invite?token=...`) and Google Calendar callback (`carebase://integrations/google?...`).

### Navigation & Screens
- React Navigation native stack in `src/navigation/AppNavigator.tsx`.
- Key screens: `PlanScreen`, `AppointmentDetailScreen`, `BillDetailScreen`, `SettingsScreen`.
- Settings hosts collaborator management, Google Calendar controls, and logout.

### Theming & UI
- `ThemeProvider` exposes palette/spacing/shadow hooks and respects system light/dark mode.
- Components build styles inside `useMemo(() => createStyles(...))` for performance.

### API Layer
- `src/api/client.ts` configures Axios client with baseURL from env and bearer token interceptor (reads `AsyncStorage`).
- Individual feature APIs live under `src/api/` (collaborators, Google integration, etc.).

### Testing
- Jest + `@testing-library/react-native`.
- Suite covers bootstrap (`App.test.tsx`), settings flows, and Google integration hook.
- Use `npm run test --workspace=mobile` or `npm run test:coverage --workspace=mobile`.

---

## 5. Contracts & Shared Types
- `shared/types/index.ts` defines canonical domain models (`User`, `Recipient`, `Appointment`, `Bill`, `Collaborator`, `PlanPayload`, ...).
- Contracts workspace (`tests/`) spins up an in-memory Postgres (`pg-mem`) and hits `/api/plan` + `/api/collaborators` to ensure responses stay aligned with shared payload types.

---

## 6. Development Workflow

### Common Commands
```bash
npm install                     # root install
npm run dev:backend             # API (development env)
npm run dev:backend:prod        # API (carebase.dev)
npm run env:mobile:dev          # Expo env → ngrok
npm run env:mobile:prod         # Expo env → carebase.dev
(cd mobile && npx expo start)   # Launch Expo
npm run db:migrate              # Run migrations
```

### Testing Matrix
```bash
npm run test:backend
npm run test --workspace=mobile
npm run test --workspace=shared
npm run test:contracts
npm run coverage                # backend + mobile coverage
```

### CI
- GitHub Actions workflow `.github/workflows/ci.yml` runs on `dev`/`main` pushes + PRs.
- Steps: install deps, run backend/mobile/shared/contracts tests, generate coverage, upload artifacts.

### Railway Deployment
- Install: `npm install`
- Start command: `npm run start --workspace=backend`
- Environment: set `CAREBASE_ENV=production`, `BASE_URL=https://carebase.dev`, Google/Postmark secrets, etc.

---

## 7. Coding & Review Guidelines
- TypeScript everywhere; default to `const`, 2-space indentation, trailing semicolons.
- Routes do minimal work—delegate to controllers/services.
- Update `backend/src/routes/registry.metadata.ts` when adding/removing routers so docs remain accurate.
- Tests live next to the code (`*.test.ts` or `*.test.tsx`).
- Commit after each logical change; keep messages imperative.
- PR template: summary, testing notes (commands run), new env vars, migration IDs, screenshots if UI-affecting.

---

## 8. Reference
- CI workflow: `.github/workflows/ci.yml`
- API docs generator: `npm run docs:routes --workspace=backend`
- Contract harness: `tests/src/plan.contract.test.ts`
- Expo env swap: `scripts/swap-mobile-env.js`
- Backend env runner: `scripts/run-backend.js`

---

Questions or onboarding issues? Post them alongside the code in this doc so new contributors don’t miss the context.
