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
```

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
