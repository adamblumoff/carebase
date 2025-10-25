# Carebase

Monorepo for the Carebase healthcare coordination platform.

## TL;DR
- **Backend**: TypeScript + Express (`backend/`)
- **Mobile**: Expo React Native (`mobile/`)
- **Shared**: Cross-runtime types (`shared/`)
- **Contracts**: API contract tests (`tests/`)

## Prerequisites
- Node.js **>= 20.19.4** (Expo 54 / React Native 0.81 enforce this engine; Node 18 will continue to emit warnings and can break bundler/Metro tooling)
- npm 9+

## Quick Start
```bash
nvm use   # respects .nvmrc (installs 20.19.4 if needed)
npm install
npm run dev:backend          # start API against local env
npm run env:mobile:dev       # point Expo at ngrok backend
(cd mobile && npx expo start --clear)
```

## Test Matrix
```bash
npm run test:backend
npm run test --workspace=mobile
npm run test --workspace=shared
npm run test:contracts
npm run coverage
```

All test targets now run on Vitest; legacy `tsx --test` harnesses have been removed.

## Environment Profiles
Backend reads `.env.<env>` + `.env.<env>.local`, where `<env>` defaults to `development`. Handy helpers:
- `npm run dev:backend` – uses `.env.development.local`
- `npm run dev:backend:prod` – uses `.env.production.local`
- `npm run env:mobile:dev` / `npm run env:mobile:prod` – swap Expo `.env.local`

Templates live at `env.development.local.example`, `env.production.local.example`, and matching files inside `mobile/`.

## Detailed Docs
See [docs/DETAILS.md](docs/DETAILS.md) for architecture, workflow, and integration notes. Mobile-specific guidance lives in [mobile/README.md](mobile/README.md).
