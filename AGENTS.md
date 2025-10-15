# Repository Guidelines

## Project Structure & Module Organization
Carebase runs as an npm workspaces monorepo. `backend/` hosts the Express + TypeScript API with domain folders under `src/` (auth, routes, services, jobs, views) and maintenance utilities in `scripts/`. Route wiring is centralized in `backend/src/routes/registry.ts`, and individual Express routers delegate to controllers in `backend/src/controllers`. `mobile/` is the Expo React Native app; feature logic lives in `src/` while `App.tsx` now wraps navigation with the shared `ThemeProvider`. `shared/` publishes typed constants consumed by both runtimes via workspace imports. Use `tests/` for cross-workspace integration specs and keep ad hoc uploads or OCR fixtures inside `uploads/` so they stay out of source control.

Key collaborator invite files:
- `backend/src/routes/api/collaborators.ts` – REST endpoints for listing, inviting, accepting. Acceptance now enforces that the logged-in email matches the invite email and updates the collaborator row accordingly.
- `backend/src/routes/collaborators.ts` & `backend/src/views/collaborator-accept.ejs` – landing page served for email links, including messaging for wrong-account scenarios.
- `mobile/App.tsx` – handles deep-link tokens (`carebase://invite?token=…`) and runs acceptance after sign-in.

## Build, Test, and Development Commands
Install dependencies once with `npm install` at the repository root. Run the API locally via `npm run dev:backend` (tsx watch on `src/server.ts`). Launch the mobile app with `npm run dev:mobile`; Expo will respect the device theme (`app.json` sets `userInterfaceStyle` to `automatic`). If the Metro cache gets stuck after config changes, restart with `npx expo start -c`. Set `EXPO_PUBLIC_API_BASE_URL` in `app.config`/`.env` to your backend URL (ngrok when on device). Execute all workspace tests through `npm test`, or scope to the backend with `npm run test:backend` for faster iteration. Apply migrations using `npm run db:migrate`, and load sample data with `node backend/scripts/add-test-data.js` after authenticating locally.

Collaborator invite configuration:
- Backend requires `COLLABORATOR_INVITE_BASE_URL`, `COLLABORATOR_APP_OPEN_URL` (include `{token}` placeholder), and optionally `COLLABORATOR_APP_DOWNLOAD_URL`. Expo deep links such as `exp://…/invite?token={token}` work when running through a tunnel.
- When testing via ngrok, restart the backend after updating env vars and resend invites so the new URLs propagate.

## Coding Style & Naming Conventions
Backend and shared code use strict TypeScript with ES modules; keep 2-space indentation, trailing semicolons, and `const` by default. Route files live under `routes/` where they simply bind Express routes to controller functions in `controllers/`. The full API matrix lives in `routes/registry.ts`—update it whenever you add or remove endpoints. Exported types stay in `shared/types` using PascalCase interfaces. In the mobile app, components are PascalCase under `src/screens` or `src/components`. Always derive colors and spacing from `useTheme()` (`mobile/src/theme.tsx`) within React components: memoize StyleSheets with `useMemo(() => createStyles(palette, shadow), [palette, shadow])` and avoid importing the palette directly. Keep environment bootstrapping imports (see `backend/src/server.ts`) at the top so `env.ts` loads before other modules. Never hard-code personal tunnel URLs; rely on configurable env vars (`BASE_URL`, `EXPO_PUBLIC_API_BASE_URL`).

## Testing Guidelines
Backend unit and integration tests belong next to the code as `*.test.ts` and run via Node’s test runner through tsx. Aim to cover route handlers, job schedulers, and data access helpers; document any external service fakes inside the spec. The `tests/` workspace is reserved for higher-level flows; create self-contained fixtures and clean up generated records. Run backend tests with `npm test --workspace=backend`. When introducing mobile tests, use Jest (`npm test --workspace=mobile`) with `@testing-library/react-native`, snapshot UI states per screen, and mock `useTheme()` to keep snapshot noise low.

Collaborator invite testing tips:
- `backend/src/routes/api/collaborators.test.ts` contains simple unit coverage for email matching; expand it if validation logic grows.
- Add integration tests when touching acceptance to confirm `/api/collaborators/accept` rejects mismatched emails and updates existing rows.
- Mobile deep-link logic is exercised in `App.tsx`; when writing Jest tests, mock `Linking.getInitialURL` / `addEventListener` and `ToastProvider`.

## Commit & Pull Request Guidelines
Commits should stay concise, imperative, and focused (e.g., “Replace cookie manager with AsyncStorage”). Reference issues in the body if applicable and avoid batching unrelated changes. Pull requests need a short summary, testing notes (`npm run test:backend`, `npm test --workspace=mobile`, simulator screenshots, etc.), call out new env vars, and include migration IDs when schema changes apply. When modifying theming or Expo config, mention whether you cleared the Metro cache and confirmed both light/dark modes. Regenerate API route docs with `npm run docs:routes --workspace=backend` whenever routers change.

Commit after every semi-major feature change so reviewers can follow the progression without wading through mega-diffs.
