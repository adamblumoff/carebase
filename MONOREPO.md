# Carebase Monorepo Structure

This repository is organized as a monorepo containing the backend API and React Native mobile app.

## Directory Structure

```
carebase/
├── backend/              # Node.js + Express backend
│   ├── src/
│   │   ├── auth/        # Passport.js authentication
│   │   ├── controllers/ # Express handlers referenced by routes
│   │   ├── db/          # PostgreSQL client & queries
│   │   ├── jobs/        # Cron jobs (Friday digest)
│   │   ├── middleware/  # Express middleware
│   │   ├── routes/      # Route registration + Express routers
│   │   ├── services/    # Parser, email, storage, OCR
│   │   ├── views/       # EJS templates (legacy web views)
│   │   └── server.ts    # Express app entry point
│   ├── scripts/         # Database migrations & test data
│   └── package.json     # Backend dependencies
├── mobile/              # React Native + Expo mobile app
│   ├── src/             # Screens, navigation, theme, utilities
│   ├── App.tsx          # Main app component with ThemeProvider + navigator
│   └── package.json     # Mobile dependencies
├── shared/              # Shared code (types, constants)
│   ├── types/           # TypeScript type definitions
│   └── package.json     # Shared package config
├── .env.local           # Environment variables (root level)
└── package.json         # Root workspace configuration
```

## Workspaces

This repo uses npm workspaces to manage multiple packages:

- `@carebase/backend` - Backend API server
- `@carebase/mobile` - React Native mobile app
- `@carebase/shared` - Shared TypeScript types
- `@carebase/contracts` - Cross-workspace API contract tests (Express + shared types)

## Development Scripts

### Run Backend
```bash
npm run dev                # Run backend dev server
npm run dev:backend        # Same as above
```

### Run Mobile App
```bash
npm run dev:mobile         # Start Expo development server
```

### Testing
```bash
npm test                                # Run all tests across workspaces
npm test --workspace=@carebase/backend  # Backend suite (unit + pg-mem integration)
npm test --workspace=@carebase/shared   # Shared type guards
npm run test --prefix tests     # Cross-workspace API contracts
```

The backend suite includes unit specs and pg-mem powered integration coverage (e.g., inbound email webhook). Running backend tests does not require a local Postgres instance.

### Coverage

```bash
npm run coverage            # Backend Node test coverage + mobile Jest coverage
```

### Environment Configuration

Environment variables are layered. The backend loads, in order, `.env`, `.env.<env>`, `.env.local`, `.env.<env>.local`, where `<env>` is taken from `CAREBASE_ENV` (fallback `NODE_ENV`, default `development`). Later files override earlier ones.

**Bootstrap templates**

```bash
# Backend (local + prod templates)
cp env.development.local.example .env.development.local
cp env.production.local.example .env.production.local

# Mobile Expo app
cp mobile/.env.development.local.example mobile/.env.development.local
cp mobile/.env.production.local.example mobile/.env.production.local
```

- Local feature work: keep `CAREBASE_ENV=development` (default) and point the development env files to your ngrok tunnel.
- Production smoke test: run `CAREBASE_ENV=production npm run dev:backend` to target `https://carebase.dev`, and start Expo with the prod env file, e.g. `npx expo start --env-file .env.production.local`.

### Continuous Integration

- Workflow: `.github/workflows/ci.yml`
- Runs on pushes and pull requests targeting `dev` and `main`
- Steps: install dependencies, run backend/mobile/shared/contracts suites, execute `npm run coverage`, upload backend/mobile coverage artifacts

### Database
```bash
npm run db:migrate         # Run database migrations
```

## Backend API (Current)

The backend currently runs as a web app with EJS views. Features:

- **Authentication**: Google OAuth 2.0
- **Email Forwarding**: Postmark webhook receives forwarded emails
- **Parser**: Rules-based classification (appointment/bill/noise)
- **Database**: PostgreSQL with users, recipients, appointments, bills
- **Jobs**: Friday digest cron job
- **File Upload**: Multer for photo uploads with OCR
- **Collaborators (MVP)**: Owners can invite contributors to view the shared plan and show assignment responsibility in the mobile app

### Routes
- Route registration table: see `backend/src/routes/registry.ts` for every mounted router and API endpoint summary.
- `/` - Landing page
- `/auth/google` - OAuth login
- `/plan` - Weekly plan (7-day view)
- `/review` - Low-confidence items for manual review
- `/settings` - User settings & forwarding address
- `/upload` - Photo upload for bills
- `/webhook/inbound-email` - Postmark webhook
- `/calendar/:token.ics` - ICS file download
- `/api/integrations/google/*` - Connect, sync, and disconnect Google Calendar events

## Mobile App Overview

Current features shipped in the Expo client:

- Login (Google OAuth handoff + dev bypass)
- Weekly Plan surfaced from the API with live polling + realtime refresh
- Appointment and Bill detail editors
- Settings hub with account, preferences, and system metadata
- Camera capture + library import for bill uploads
- Shared theming via `ThemeProvider` (`mobile/src/theme.tsx`) with automatic light/dark palettes
- Google Calendar sync panel with OAuth connect/disconnect and manual sync actions

## Shared Types

Located in `/shared/types/index.ts`:

```typescript
export interface User { ... }
export interface Recipient { ... }
export interface Appointment { ... }
export interface Bill { ... }
export interface Item { ... }
// ... and more
```

These types are used by both backend and mobile to ensure type safety.

## Environment Variables

Create `.env.local` in the **root directory** with:

```bash
# Database
DATABASE_URL=postgresql://user:password@host:port/database

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Google Calendar integration (server-side)
# Optional: falls back to GOOGLE_CLIENT_ID/SECRET when undefined
GOOGLE_OAUTH_CLIENT_ID=your-calendar-client-id
GOOGLE_OAUTH_CLIENT_SECRET=your-calendar-client-secret
GOOGLE_AUTH_STATE_SECRET=super-secret-for-google-state

# Email
RESEND_API_KEY=your-resend-key
INBOUND_EMAIL_DOMAIN=inbound.yourapp.com

# App
BASE_URL=http://localhost:3000
SESSION_SECRET=your-secret-key
NODE_ENV=development

# Collaboration invites (optional override for email links)
COLLABORATOR_INVITE_BASE_URL=http://localhost:3000
COLLABORATOR_APP_OPEN_URL=carebase://invite?token={token}
COLLABORATOR_APP_DOWNLOAD_URL=https://your-download-link.example.com

# Mobile Expo env
EXPO_PUBLIC_API_BASE_URL=http://localhost:3000
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-web-client-id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your-ios-client-id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=your-android-client-id.apps.googleusercontent.com
```

### Collaborator Invite Flow

1. Owners trigger invites from the Settings Care Team screen.
2. The invited collaborator must open the email link while signed in with the invited address; other accounts will be rejected.
3. After acceptance, logging in with that email on the mobile app loads the shared recipient’s plan instead of creating a standalone account.

## Migration Notes

### What Changed
1. All backend code moved from `/src` to `/backend/src`
2. Scripts moved from `/scripts` to `/backend/scripts`
3. Root `package.json` now manages workspaces
4. Environment variables loaded from root `.env.local`
5. Mobile app initialized with Expo

### What Stayed the Same
- All backend functionality unchanged
- Database schema unchanged
- All tests still pass
- Same development workflow

## Next Steps

1. **Convert Backend to TypeScript**
   - Rename `.js` → `.ts`
   - Add type annotations
   - Import shared types

2. **Build REST API**
   - Create `/api` routes for mobile consumption
   - Keep existing web routes for now
   - Add authentication middleware

3. **Develop Mobile App**
   - Implement navigation structure
   - Build core screens
   - Connect to backend API
   - Add native features (camera, calendar, notifications)

4. **Gradual Migration**
   - Mobile app replaces web views over time
   - Backend API continues to support both
   - Eventually deprecate EJS views

## Running the Project

```bash
# Install dependencies (if not already done)
npm install

# Run backend server
npm run dev

# In another terminal, run mobile app (when ready)
npm run dev:mobile

# Run tests
npm test
```

## Contributing

When adding new features:

1. **Backend changes**: Work in `/backend`
2. **Mobile changes**: Work in `/mobile`
3. **Shared types**: Update `/shared/types/index.ts`
4. **Run tests**: `npm test` before committing
5. **Keep types in sync**: Backend and mobile should use shared types
