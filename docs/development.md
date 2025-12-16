# Development

## Prereqs

- Node.js 20+
- pnpm (recommended via Corepack)
- Expo tooling (Xcode for iOS, Android Studio for Android as needed)
- Postgres (local, Docker, or managed)

## Setup

1. Create env file:
   - Copy `.env.example` → `.env`
   - Fill in required values:
     - App auth: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`
     - API base URL: `EXPO_PUBLIC_API_BASE_URL`
     - API db: `DATABASE_URL`
     - Google ingestion (server): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_STATE_SECRET`
2. Install deps:
   - `pnpm install`

## Run (local)

### 1) Start Postgres

Use any local Postgres you like. Ensure `DATABASE_URL` points at it.

### 2) Run DB migrations

- `pnpm db:migrate`

### 3) Start the API

- `pnpm api:dev`
- Health check: `GET /healthz` on `API_HOST:API_PORT` (defaults from `.env`)

### 4) Start the Expo app

- `pnpm start` then pick a platform, or run `pnpm ios` / `pnpm android` / `pnpm web`

Base URL tips:

- iOS simulator: `EXPO_PUBLIC_API_BASE_URL=http://localhost:8080`
- Android emulator: `EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:8080`
- Physical device: `EXPO_PUBLIC_API_BASE_URL=http://<your-LAN-ip>:8080`

## Common commands

- Lint: `pnpm lint`
- Format: `pnpm format`
- Reset deps (slow): `pnpm reset:deps`

## Troubleshooting

- App shows “Missing EXPO_PUBLIC_API_BASE_URL”: confirm `.env` exists and Expo was restarted after changes.
- tRPC client error “Unexpected API response”: your `EXPO_PUBLIC_API_BASE_URL` likely points at the wrong host/port.
- API crashes on boot mentioning `GOOGLE_STATE_SECRET`: it’s required and must be set in `.env`.
- Google connect returns no refresh token: ensure the OAuth flow uses `prompt=consent` + `access_type=offline` (the API requests this), and you’re not reusing a previously-consented account without forcing consent.

