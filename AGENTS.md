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
npm run test --workspace=mobile  # mobile Jest suite
npm run test:contracts      # cross-workspace contract tests
```

## Coding Style & Naming Conventions
- TypeScript everywhere; 2-space indentation, semicolons on.
- Prefer `const`; only use `let` where mutation is required.
- File naming: kebab-case for routes/services (`api/collaborators.ts`), PascalCase for React components.
- Keep code self-contained; route files should delegate to controllers/services.

## Testing Guidelines
- Backend: `tsx --test` (Node test runner) + pg-mem for integration (`*.test.ts`).
- Mobile: Jest + `@testing-library/react-native` (`*.test.tsx`).
- Contract tests ensure API payloads align with shared types (`tests/src/plan.contract.test.ts`).
- Run `npm run coverage` to combine backend + mobile coverage reports.

## Commit & Pull Request Guidelines
- Commit messages: short, imperative (“Add backend env toggle helpers” style). Commit after each logical change.
- PRs should include: summary, tested commands, screenshots for UI changes, new env vars or migrations, and linked issues if applicable.
- Re-run test matrix before requesting review; CI (`.github/workflows/ci.yml`) mirrors that matrix.

## Environment & Deployment Tips
- Backend reads `.env.<env>` + `.env.<env>.local`; switch via `npm run dev:backend[:prod]`.
- Expo uses `.env.local`; swap via `npm run env:mobile:<dev|prod>` and restart with `npx expo start --clear`.
- Railway deployment uses `npm run start --workspace=backend`; ensure production secrets (`BASE_URL=https://carebase.dev`, Google Postmark creds) are set.
