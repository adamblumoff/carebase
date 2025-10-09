# Inbox to Week MVP

Healthcare coordination web app that transforms emails and photos into a weekly plan.

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
npm run db:migrate

# Start development server
npm run dev
```

## Environment Setup

1. **Google OAuth**: Create OAuth credentials at https://console.cloud.google.com/
2. **Resend**: Sign up at https://resend.com for email service
3. **Google Cloud Vision**: Enable Vision API for OCR
4. **Database**: Use Railway or local Postgres

## Project Structure

```
src/
├── server.js          # Main Express server
├── db/                # Database schema and queries
├── routes/            # HTTP routes
├── services/          # Business logic (parser, email, ocr)
├── views/             # EJS templates
└── public/            # Static assets
```

## Key Features

- **Google OAuth authentication** - Secure sign-in with profile scope only
- **Email forwarding intake** - Unique forwarding address per user with webhook processing
- **Photo upload with OCR** - Google Cloud Vision integration for bill text extraction
- **Rules-based parser** - Keyword and pattern matching for appointment/bill classification
- **Weekly plan page** - Read-only view of next 7 days with secret token sharing
- **ICS calendar files** - One-click "Add to Calendar" for appointments
- **Friday digest email** - Automated weekly summary sent via Resend
- **Account deletion** - Complete data removal with cascade delete

## Testing

```bash
# Run acceptance tests
npm test

# Test with mock data (when DB is running)
node src/tests/acceptance.test.js
```

## API Endpoints

- `POST /webhook/inbound-email` - Resend webhook for incoming emails
- `POST /upload/photo` - Upload bill photos (authenticated)
- `GET /plan` - View weekly plan (authenticated or with ?token=)
- `GET /calendar/:token.ics` - Download ICS file for appointment
- `GET /settings` - User settings and forwarding address
- `POST /settings/delete-account` - Delete account

## Development Notes

- Parser uses simple rule-based classification (no ML required for MVP)
- Low confidence items (< 0.7) are flagged in audit logs for manual review
- Session storage uses in-memory for development (use Redis for production)
- File storage uses local filesystem (use S3/R2 for production)
- Timezone handling defaults to America/New_York for digest scheduling

See `DEPLOYMENT.md` for production deployment instructions.
See `inbox-to-week-mvp-outline.md` for full MVP requirements.
