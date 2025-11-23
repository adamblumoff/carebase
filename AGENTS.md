# Repository Guidelines

> Context: We’re a small company with very few users today. Bias advice toward speed and pragmatism over heavyweight process; prefer incremental, low-overhead solutions that keep us shipping quickly while staying safe enough (env/secret hygiene, basic monitoring).

## Project Structure & Module Organization
- Expo app at root; routes in `app/` (file/folder maps to screen).  
- Shared UI/hooks in `components/` or `app/(components|hooks)`; global styles live in `global.css`.  
- Assets in `assets/`; configs in `app.json`, `babel.config.js`, `metro.config.js`, `tailwind.config.js`.  
- Domain helpers in `app/(lib)/<domain>/`; co-locate small types.  
- Docs/ADRs in `docs/`; automation in `scripts/`; CI/IaC in `infra/`.

## Build, Test, and Development Commands (PNPM-first)
- `pnpm install` — install via lockfile (corepack).  
- `pnpm start` — `expo start --tunnel --clear` for Metro/Expo; `pnpm ios` / `pnpm android` / `pnpm web` for targets.  
- `pnpm api:dev` — start Fastify+tRPC API (required for data screens; ensure `EXPO_PUBLIC_API_BASE_URL` points to it).  
- `pnpm prebuild` — create native projects when custom modules are needed.  
- `pnpm lint` — ESLint + Prettier check; `pnpm format` to fix.  
- Add `pnpm test` after wiring Jest + React Native Testing Library.  
- CI should reuse these scripts.

## Mobile Tech Stack (created via `pnpm create expo-stack . --expo-router --nativewind --types`, Nov 21, 2025)
- Runtime: Expo SDK 54, RN 0.81.5 (match Expo’s expected), React 19.1, Hermes.  
- Routing: Expo Router 6 (file-based) atop React Navigation 7 + gesture-handler/screens.  
- Styling: NativeWind + Tailwind 3.4; tokens in `tailwind.config.js`, base styles in `global.css`.  
- Animation: Reanimated 4.1 + worklets.  
- Forms/validation: add `react-hook-form` + `zod` when forms arrive.  
- State/Data: add TanStack Query v5 for server cache; optional Zustand for local state.  
- Tooling: TS ~5.9, ESLint 9 (flat) + `eslint-config-expo`, Prettier 3, PNPM 9.
- Keep Expo/RN deps aligned: prefer `pnpm exec expo install <pkg>` so versions match the SDK; if mismatch warnings appear, sync versions before debugging.

## Coding Style & Naming Conventions
- 4-space indentation, Unix line endings, trailing newline; prefer explicit imports.  
- Files use `kebab-case.tsx`; components/classes `PascalCase`, functions/vars `camelCase`.  
- Co-locate routes, styles, and tests; keep modules small.  
- Run `pnpm format` before commits and PRs; lint/type-check enforced in CI.

## Commit & Pull Request Guidelines
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`); one logical change per commit.  
- PRs include summary, linked issue, testing notes (`pnpm lint`, `pnpm test` when available), and UI screenshots/recordings.  
- Do not merge with failing CI; tag TODOs with issue IDs and request relevant reviews.

## Security & Configuration Tips
- Do not commit secrets; maintain `.env.example` and use `.env.local` (gitignored).  
- Enable secret scanning (e.g., gitleaks/pre-commit) and dependency auditing in CI.  
- Keep service keys least-privilege and rotate regularly.

## Getting Unstuck
- Prefer official docs first (Expo, React Native, React Navigation, NativeWind); link them in issues/PRs when they inform choices.  
- Write a short note in PRs for any tricky fixes and cite the doc page that clarified the solution.
