# Carebase

Healthcare coordination platform that auto-captures appointments and bills from emails and photos.

**Status**: Monorepo with TypeScript backend + React Native mobile app (in development)

## Quick Start

```bash
# Install all workspace dependencies
npm install

# Start backend dev server
npm run dev

# Run tests
npm test
```

## Monorepo Structure

```
carebase/
├── backend/     - Node.js + Express + TypeScript API
├── mobile/      - React Native + Expo mobile app
└── shared/      - Shared TypeScript types
```

## Environment Setup

Create `.env.local` in the root:

```env
# Database (Railway)
DATABASE_URL=postgresql://user:pass@host:port/database

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Google Calendar integration (server-side)
# Falls back to GOOGLE_CLIENT_ID/SECRET if not provided
GOOGLE_OAUTH_CLIENT_ID=your-calendar-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-calendar-client-secret
GOOGLE_AUTH_STATE_SECRET=super-secret-for-google-state

# OCR (Google Cloud Vision)
GOOGLE_APPLICATION_CREDENTIALS=./service-account-key.json
OCR_PROVIDER=google
OCR_CONFIDENCE_THRESHOLD=0.5

# Email (Postmark)
RESEND_API_KEY=your-key
INBOUND_EMAIL_DOMAIN=inbound.yourapp.com

# App
SESSION_SECRET=random-secret
MOBILE_AUTH_SECRET=another-random-secret
NODE_ENV=development
BASE_URL=http://localhost:3000
# Optional: link used in invite emails (defaults to BASE_URL)
COLLABORATOR_INVITE_BASE_URL=http://localhost:3000
COLLABORATOR_APP_OPEN_URL=carebase://invite?token={token}
COLLABORATOR_APP_DOWNLOAD_URL=https://your-download-link.example.com

# Mobile
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your-ios-client-id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=your-android-client-id.apps.googleusercontent.com
```

### Collaborator Invites

1. The owner sends an invite from Settings → Care Team (owners only).
2. The invited person must open the email on the device where the app runs and tap **Open Carebase app**.
3. The invite can only be redeemed by the email address it was sent to. If the owner opens the link first, they’ll see a warning and the invited user can still accept it later.
4. Once accepted, logging in with the invited email will show the shared plan instead of creating a new account.

### Google Calendar Integration

1. Create OAuth 2.0 clients for iOS, Android, and Web in Google Cloud. Enable the **Google Calendar API** and add your Expo redirect scheme (`carebase://auth`) under Authorized redirect URIs.
2. Populate the server credentials (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`) and add a signing secret (`GOOGLE_AUTH_STATE_SECRET`). The backend falls back to the existing `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` if the integration-specific values are omitted.
3. In the Expo app, set `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID` env vars. The mobile client calls the backend to generate an ngrok-safe Google consent URL and handles the returning `carebase://integrations/google` deep link—no more direct Google redirects.
4. From the mobile Settings → **Calendar sync** panel, tap **Connect Google Calendar**. The backend stores the returned tokens and queues an initial sync.
5. Manual sync and disconnect actions also live in the Settings screen. The backend stores a per-item hash/etag to avoid duplicating events and reconciles edits from either side during every sync.

## External Services

1. **Railway**: PostgreSQL database
2. **Google OAuth**: Authentication
3. **Postmark**: Email forwarding + outbound
4. **Google Cloud Vision**: OCR for bill photos (optional)

## How It Works

1. User forwards emails to unique address: `user-123-abc@inbound.yourapp.com`
2. Postmark webhook receives → backend parses content
3. Rules-based classifier extracts appointments/bills
4. User sees weekly plan: **Show Up** (appointments) + **Pay** (bills)
5. Export appointments via ICS files
6. Friday digest emails upcoming week

## Development

```bash
# Backend only
npm run dev:backend

# Mobile (when ready)
npm run dev:mobile

# Run backend tests
npm test --workspace=@carebase/backend

# Database migration
npm run db:migrate
```

### Mobile Auth Flow

- Google OAuth redirects back to the app with a short-lived `authToken`. The mobile client calls `POST /api/auth/mobile-login` to exchange it for a 7-day bearer `accessToken`.
- `accessToken` is stored in `AsyncStorage` and attached to every request through the axios interceptor in `mobile/src/api/client.ts`.
- Configure `MOBILE_AUTH_SECRET` on the backend and `EXPO_PUBLIC_API_BASE_URL` in Expo so both sides agree on token signing and API base URLs.

### Mobile Theming

- The Expo app wraps `AppNavigator` with a shared `ThemeProvider` defined in `mobile/src/theme.tsx`.
- Use the `useTheme()` hook (instead of importing color constants) to access `palette`, `shadow`, `spacing`, and `radius`.
- Build styles inside `useMemo(() => createStyles(palette, shadow), [palette, shadow])` so they respond to light/dark changes.
- Expo respects the device setting (`app.json` sets `"userInterfaceStyle": "automatic"`), so test both modes when adding UI.

## Tech Stack

- **Backend**: TypeScript, Express, PostgreSQL, Passport.js
- **Mobile**: React Native, Expo, TypeScript
- **Shared**: TypeScript types for both platforms
- **Deployment**: Railway (backend), Expo (mobile)

## Documentation

- `MONOREPO.md` - Monorepo structure and development guide
- `CLAUDE.md` - Project guidance for Claude Code

## License

UNLICENSED - Private project
