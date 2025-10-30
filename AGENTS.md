# Repository Guidelines

## Project Structure & Module Organization
- `backend/`: Express + TypeScript API (`src/auth`, `src/controllers`, `src/db`, `src/routes`, `src/services`)
- `mobile/`: Expo React Native app (`src/screens`, `src/api`, `src/hooks`, `src/ui`).
- `shared/`: Cross-runtime TypeScript types.
- `tests/`: API contract tests using pg-mem + supertest.
- Env templates are in root (`env.*.example`) and `mobile/` (`.env.*.example`).

## Build, Test, and Development Commands
```bash
npm install                 # install all workspace deps
npm run dev:backend         # start API with development env
npm run dev:backend:prod    # start API against carebase.dev
npm run env:mobile:dev      # copy Expo env for ngrok
npm run env:mobile:prod     # copy Expo env for production
(cd mobile && npx expo start --clear)  # launch Expo bundler
npm run test:backend        # backend unit/integration tests
npm run test --workspace=mobile  # mobile Vitest suite
npm run test:contracts      # cross-workspace contract tests
```

## Coding Style & Naming Conventions
- TypeScript everywhere; 2-space indentation, semicolons on.
- Prefer `const`; only use `let` where mutation is required.
- File naming: kebab-case for routes/services (`api/collaborators.ts`), PascalCase for React components.
- Keep code self-contained; route files should delegate to controllers/services.

## Testing Guidelines
- Backend: Vitest (unit + integration) with pg-mem (`*.vitest.test.ts`). Contract suites (`tests/`) run under the same runner.
- Mobile: Vitest + React Testing Library (`*.vitest.test.tsx`). Presenters/helpers, medication summary/detail UI, notification hooks, and API shims are covered; full RN screens stay excluded from coverage thresholds.
- Contract tests ensure API payloads align with shared types (`tests/src/plan.contract.vitest.test.ts`).
- `npm run coverage` runs backend + mobile coverage. Mobile thresholds enforce ≥65% statements/lines (branches 55%, functions 65%) for logic modules.
- Medication hard-delete flows now have backend + contract coverage (`tests/src/medications.contract.vitest.test.ts`) and mobile API/hook/UI tests. After touching destructive logic, run `npm run test:backend`, `npm run test:contracts`, and `npm run test --workspace=mobile` to confirm.

## Commit & Pull Request Guidelines
- Commit messages: short, imperative (“Add backend env toggle helpers” style). Commit after each logical change.
- PRs should include: summary, tested commands, screenshots for UI changes, new env vars or migrations, and linked issues if applicable.
- Re-run test matrix before requesting review; CI (`.github/workflows/ci.yml`) mirrors that matrix.

## Environment & Deployment Tips
- Backend reads `.env.<env>` + `.env.<env>.local`; switch via `npm run dev:backend[:prod]`.
- Expo uses `.env.local`; swap via `npm run env:mobile:<dev|prod>` and restart with `npx expo start --clear`.
- Railway deployment uses `npm run start --workspace=backend`; ensure production secrets (`BASE_URL=https://carebase.dev`, Google Postmark creds) are set.
- The backend now refuses to boot unless `CLERK_SECRET_KEY`, `GOOGLE_AUTH_STATE_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `DATABASE_URL` are present. Each value must be unique—do not reuse one secret for multiple roles. In CI/local test runs the loader supplies deterministic placeholders automatically.
- Database TLS uses `DATABASE_SSL` (defaults to `require` in production) plus `DATABASE_SSL_CA` or `DATABASE_SSL_CA_BASE64` for the Railway PEM bundle. Keep `DATABASE_SSL_REJECT_UNAUTHORIZED` at its default `true`; set `DEBUG_SQL=true` locally if you need verbose query logging.
- Google OAuth credentials are encrypted at rest. Configure `GOOGLE_CREDENTIALS_ENCRYPTION_KEY` (32-byte base64 or hex) alongside `POSTMARK_INBOUND_SECRET`/`RESEND_INBOUND_SECRET` for webhook verification and `INBOUND_WEBHOOK_RATE_LIMIT` if you need to loosen the default 30 req/min window.
- Google Cloud Vision OCR no longer relies on the `care-base-mvp-*.json` file. Export the service-account JSON (raw or base64) via `OCR_SERVICE_ACCOUNT_JSON` to run OCR locally and in production; the loader falls back to `GOOGLE_APPLICATION_CREDENTIALS` when the inline secret is absent.
- Google Calendar webhooks must target the API origin. Set `GOOGLE_SYNC_WEBHOOK_BASE_URL` (or `BASE_URL`) to `https://api.carebase.dev` in production so Google delivers notifications, and provide `GOOGLE_SYNC_DEFAULT_TIME_ZONE` (e.g. `America/Chicago`) so pushed appointments retain the expected local time.
- Mobile access tokens now live in SecureStore when available. Ensure Expo envs include the Google client IDs and keep `expo-secure-store` installed; AsyncStorage is used automatically when SecureStore isn't supported.
- Database migrations run from a single source of truth (`backend/src/db/schema.sql`). After any schema edit, run `npm run db:migrate --workspace=backend` locally (uses `.env.development.local`). Before deploying, execute the same command with production env vars (Railway CLI or job) so staging and production pick up the change.
- Clerk performance tuning: use a long-lived JWT template (e.g. `carebase-backend`) and expose it via `CLERK_JWT_TEMPLATE_NAME` on the backend plus `EXPO_PUBLIC_CLERK_JWT_TEMPLATE` on mobile. Without it the backend cache misses and every request stalls on Clerk.
- Medication notifications: Expo push handles primary reminders; the mobile app mirrors the next few intakes into local notifications (6-hour window, two-minute catch-up for overdue doses). These are cleared automatically whenever the plan refreshes. During QA, run the dev client (not Expo Go) so notification permissions and categories register correctly.
- Medication deletion is a hard delete. After exercising the feature locally, verify audit trails via `SELECT action, meta FROM audit WHERE action LIKE 'medication_%' ORDER BY id DESC LIMIT 5;` and confirm reminder jobs are cleared (no pending Expo/local reminders for the deleted medication).
