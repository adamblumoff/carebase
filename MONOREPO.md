# Carebase Monorepo Structure

This repository is organized as a monorepo containing the backend API and React Native mobile app.

## Directory Structure

```
carebase/
├── backend/              # Node.js + Express backend
│   ├── src/
│   │   ├── auth/        # Passport.js authentication
│   │   ├── db/          # PostgreSQL client & queries
│   │   ├── jobs/        # Cron jobs (Friday digest)
│   │   ├── middleware/  # Express middleware
│   │   ├── routes/      # API routes
│   │   ├── services/    # Parser, email, storage, OCR
│   │   ├── views/       # EJS templates (legacy web views)
│   │   └── server.js    # Express app entry point
│   ├── scripts/         # Database migrations & test data
│   └── package.json     # Backend dependencies
├── mobile/              # React Native + Expo mobile app
│   ├── src/             # (to be built)
│   ├── App.tsx          # Main app component
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
npm test                   # Run all tests across workspaces
npm test --workspace=@carebase/backend  # Run backend tests only
```

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

### Routes
- `/` - Landing page
- `/auth/google` - OAuth login
- `/plan` - Weekly plan (7-day view)
- `/review` - Low-confidence items for manual review
- `/settings` - User settings & forwarding address
- `/upload` - Photo upload for bills
- `/webhook/inbound-email` - Postmark webhook
- `/calendar/:token.ics` - ICS file download

## Mobile App (Next Steps)

The mobile app is initialized but not yet built. Planned features:

### Phase 1: Core Screens
- Welcome/Login (Google OAuth)
- Onboarding (email forwarding setup)
- Plan Screen (Show Up + Pay)
- Appointment Detail
- Bill Detail
- Settings

### Phase 2: Mobile Features
- Native calendar integration (replace ICS files)
- Photo capture for bill upload
- Push notifications for reminders
- Offline support

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

# Email
RESEND_API_KEY=your-resend-key
INBOUND_EMAIL_DOMAIN=inbound.yourapp.com

# App
BASE_URL=http://localhost:3000
SESSION_SECRET=your-secret-key
NODE_ENV=development
```

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
