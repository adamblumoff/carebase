# Carebase MVP

Healthcare coordination web app that transforms emails and photos into a weekly plan with two actions: Pay bills and Show up to appointments.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
npm run db:migrate

# Start development server
npm run dev
```

## Environment Variables

### For Local Development

Create a `.env.local` file (this file is gitignored) based on `.env.example`:

```env
# Database
DATABASE_URL=postgresql://user:pass@host:port/database

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Session
SESSION_SECRET=your-random-session-secret

# Email (Postmark)
POSTMARK_SERVER_TOKEN=your-postmark-server-token
INBOUND_EMAIL_DOMAIN=carebase.dev

# Optional: Google Cloud Vision for OCR
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json

# App
NODE_ENV=development
PORT=3000
BASE_URL=http://localhost:3000
```

## External Services Setup

### 1. Railway Database
- Sign up at https://railway.app
- Create new Postgres database
- Copy connection string to `DATABASE_URL`

### 2. Google OAuth
- Go to https://console.cloud.google.com/apis/credentials
- Create OAuth 2.0 Client ID
- Add authorized redirect URI: `https://your-domain.com/auth/google/callback`
- Copy Client ID and Secret to `.env`

### 3. Postmark Email
- Sign up at https://postmarkapp.com (free 100 emails)
- Create server and get API token
- Set up inbound email domain with MX records
- Configure webhook: `https://your-domain.com/webhook/inbound-email`

### 4. Domain DNS (for email)
- Add MX record: `@ MX 10 inbound.postmarkapp.com`
- Wait for DNS propagation (5-30 minutes)

## Project Structure

```
src/
├── server.js           # Express app with OAuth and routes
├── db/
│   ├── schema.sql      # Database schema (7 tables)
│   ├── client.js       # Postgres connection pool
│   ├── queries.js      # Database operations
│   └── migrate.js      # Migration runner
├── routes/
│   ├── auth.js         # Google OAuth flow
│   ├── webhook.js      # Postmark inbound email webhook
│   ├── plan.js         # Weekly plan view
│   ├── calendar.js     # ICS file downloads
│   ├── upload.js       # Photo upload with OCR
│   └── settings.js     # User settings and account deletion
├── services/
│   ├── parser.js       # Rules-based classification and extraction
│   ├── ics.js          # ICS calendar file generation
│   ├── email.js        # Outbound email (digest)
│   ├── storage.js      # File storage
│   └── ocr.js          # Google Cloud Vision integration
├── views/              # EJS templates
├── jobs/
│   └── digest.js       # Friday digest cron job
└── auth/
    └── passport.js     # Passport configuration
```

## Key Features

- **Google OAuth authentication** - Secure sign-in
- **Email intake** - Forward emails to unique address per user
- **Photo upload with OCR** - Extract text from bill images
- **Auto-classification** - Rules-based parser for appointments and bills
- **Weekly plan page** - Next 7 days view with sharing token
- **ICS calendar files** - Add appointments to any calendar
- **Friday digest** - Weekly email summary
- **Account deletion** - Complete data removal

## API Endpoints

- `GET /` - Landing page
- `GET /auth/google` - Start OAuth flow
- `GET /auth/google/callback` - OAuth callback
- `POST /webhook/inbound-email` - Postmark webhook (supports both Postmark and Resend formats)
- `POST /upload/photo` - Upload bill photo (authenticated)
- `GET /plan` - Weekly plan (authenticated or with ?token=)
- `GET /calendar/:token.ics` - Download appointment ICS file
- `GET /settings` - User settings
- `POST /settings/delete-account` - Delete account

## Database Schema

- **users** - Google OAuth profiles, forwarding addresses
- **recipients** - Care recipients (default one per user)
- **sources** - Email/photo intake records
- **items** - Classified items (appointment, bill, noise)
- **appointments** - Structured appointment data
- **bills** - Structured bill data with payment tracking
- **audit** - Classification decisions for review

## Deployment

### Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and link project
railway login
railway link

# Set environment variables in Railway dashboard
# Deploy
railway up
```

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Update Google OAuth callback URL
- [ ] Configure Postmark webhook with production URL
- [ ] Set secure `SESSION_SECRET`
- [ ] Verify DNS MX records
- [ ] Test end-to-end email flow
- [ ] Test account deletion

## Testing

Send test email to your forwarding address (shown in Settings):

```
Subject: Appointment Reminder

Your appointment is scheduled for:

Date: Saturday, October 11, 2025
Time: 3:00 PM
Location: Downtown Clinic, 123 Main St

Please arrive 15 minutes early.
```

Should create appointment on plan page with "Add to Calendar" button.

## Development Notes

- Parser uses keyword matching and regex patterns (no ML)
- Confidence scores flag low-quality extractions for review
- ICS files are token-protected per appointment
- Plan page supports secret token sharing for family members
- Timestamps stored without timezone (assumes local time)

## License

UNLICENSED - Private project
