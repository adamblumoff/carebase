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

- Google OAuth authentication
- Email forwarding intake
- Photo upload with OCR
- Rules-based appointment/bill parser
- Read-only weekly plan page
- ICS calendar file generation
- Friday digest email
- Account deletion

See `inbox-to-week-mvp-outline.md` for full requirements.
