# Carebase – Detailed Reference

This guide captures the full architecture, workflows, and conventions for the Carebase monorepo. The top-level [README](../README.md) stays intentionally lightweight; come here when you need the specifics.

---

## 1. Repository Layout

```
carebase/
├── backend/                # Express + TypeScript API
│   ├── src/
│   │   ├── controllers/    # REST handlers (thin HTTP wrappers)
│   │   ├── db/             # Query helpers + pg client
│   │   ├── middleware/     # Express middleware
│   │   ├── routes/         # Express routers
│   │   ├── services/       # Domain/business logic (plan, bills, Google, etc.)
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
- Clerk manages hosted sign-in (backend bridge lives in `services/clerkSyncService.ts` + `middleware/attachBearerUser.ts`).
- Clients authenticate by forwarding Clerk session tokens to both REST and realtime endpoints.

### Request Pipeline
1. `server.ts` loads env, mounts middleware (JSON, session, bearer-token attach) and registers routers via `routes/registry.ts`.
2. API routers delegate to controllers in `backend/src/controllers`, which now act as thin HTTP wrappers.
3. Database queries live under `backend/src/db/queries/` (with a barrel file at `backend/src/db/queries.ts`) and share the same connection pool exported by `db/client.ts`.
4. Domain/business logic belongs in `backend/src/services/`:
- `planService.ts` builds plan payloads consumed by `/api/plan`.
- `appointmentService.ts`/`billService.ts` encapsulate owner vs collaborator behavior (including Google-sync side effects).
- `medicationService.ts` manages CRUD, intake acknowledgements, refill projection writes, and owner collaborator enforcement. Controller wiring lives under `controllers/api/medications.ts`; contract coverage sits in `tests/src/medications.contract.vitest.test.ts`.
- `googleIntegrationService.ts` handles OAuth URL creation, token exchange, manual sync, and disconnect flows.
5. Route input validation uses zod via `utils/validation.ts`; controllers call `validateBody/validateParams`, and throw `HttpError` subclasses (`UnauthorizedError`, `ValidationError`, `NotFoundError`, etc.) handled uniformly by `utils/httpHandler.ts`.

### Email Ingestion
- Postmark webhook hits `/webhook/inbound-email`.
- `parser.ts` classifies text as bill/appointment/noise and extracts structured payloads.
- Parsed appointments/bills are stored under `appointments`/`bills`; `touchPlanForUser` bumps plan version + realtime notifications.

### Collaborators
- `/api/collaborators` handles listing/inviting/accepting.
- Acceptance enforces email match (`emailsMatch`) to prevent the owner from redeeming invites.
- `/collaborators/accept` serves a static HTML landing page (no EJS dependencies).

### Google Calendar Sync
- OAuth endpoints at `/api/integrations/google/*`.
- Tokens are stored in `google_credentials`; per-item sync metadata in `google_sync_links`.
- `services/googleSync.ts` manages job scheduling, de-bounces syncs, and reconciles remote vs local changes. Run-time configuration lives in `services/googleSync/config.ts`, and logs go through `services/googleSync/logger.ts`.
- `services/googleIntegrationService.ts` wraps OAuth URL creation, token exchange (client & server), manual sync, and disconnect logic used by the controller.

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
- React Navigation native stack in `src/navigation/AppNavigator.tsx` (registered via `navigationRef` so notifications can deep-link into the plan).
- Key screens: `PlanScreen`, `AppointmentDetailScreen`, `BillDetailScreen`, `SettingsScreen`, `CameraScreen`.
- The plan screen hosts the medication summary list, detail sheet, and add/edit flow. Owners add medications manually or from forwarded emails; the camera flow now handles bill uploads only. Collaborators see the same rows but without quick actions.
- Settings hosts collaborator management, Google Calendar controls, and logout.

### Theming & UI
- `ThemeProvider` exposes palette/spacing/shadow hooks and respects system light/dark mode.
- Components build styles inside `useMemo(() => createStyles(...))` for performance.

### API Layer
- `src/api/client.ts` configures Axios client with baseURL from env and bearer token interceptor (reads `AsyncStorage`).
- Feature-specific wrappers live under `src/api/` (plan, collaborators, medications, Google integration, uploads). Medication APIs now expose CRUD helpers for doses, intakes, and refill projections.

### Utilities
- Shared date helpers (`src/utils/date.ts`) centralize parsing/formatting used across Plan and Appointment screens.
- `src/notifications/useNotifications.ts` registers Expo notification handlers, requests permissions, and routes medication reminders to the Plan screen.
- `src/notifications/localMedicationReminders.ts` mirrors upcoming medication intakes into local notifications as a fail-safe when push delivery is delayed.

### Testing
- Vitest + React Testing Library (web renderer).
- Suites cover bootstrap (`App.tsx` providers), settings flows, notification hooks, medication summary/detail components, medication API shims, and local reminder utilities.
- Use `npm run test --workspace=mobile` (or `vitest --run --reporter=verbose` inside the workspace).

---

## 5. Contracts & Shared Types
- `shared/types/index.ts` defines canonical domain models (`User`, `Recipient`, `Appointment`, `Bill`, `Collaborator`, `PlanPayload`, ...).
- Contracts workspace (`tests/`) spins up pg-mem and hits `/api/plan` + `/api/collaborators` to ensure responses stay aligned with shared payload types.

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
- Env: set `CAREBASE_ENV=production`, `BASE_URL=https://carebase.dev`, Google/Postmark secrets, etc.

---

## 7. Coding & Review Guidelines
- TypeScript everywhere; default to `const`, 2-space indentation, trailing semicolons.
- Controllers stay thin and delegate to services. Throw `HttpError` subclasses for predictable responses.
- Update `backend/src/routes/registry.metadata.ts` when adding/removing routers so docs stay accurate.
- Tests live next to the code (`*.test.ts` / `*.test.tsx`).
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
