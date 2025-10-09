# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Carebase is a healthcare coordination web app that transforms emails and photos into a weekly plan with two primary actions: **Pay** bills and **Show up** to appointments. The goal is zero typing after setup, with calendar integration through ICS files only.

## Core Product Principles

- **Minimal scope**: Keep the MVP tiny, build trust first before expanding
- **Zero typing**: After initial setup, users should not need to type anything
- **Privacy first**: Store minimal email content, encrypt sensitive data at rest, provide clean account deletion
- **Auto-capture focus**: Success is measured by how much can be automatically captured without manual review (target: 60%+ hit rate)

## Technology Stack

- **Backend**: Node.js with Express
- **Database**: PostgreSQL (hosted on Railway)
- **Authentication**: Passport.js with Google OAuth 2.0 (profile scope only)
- **Email**: Postmark (inbound and outbound)
- **OCR**: Google Cloud Vision API (optional)
- **Templates**: EJS
- **File uploads**: Multer
- **Scheduled jobs**: node-cron
- **Deployment**: Railway

## Data Model Architecture

The system uses a hierarchical structure:

- **Users** → authenticated via Google OAuth (profile scope only)
- **Recipients** → care recipients (one default per user initially)
- **Sources** → intake points (email or photo upload)
- **Items** → classified entries linking to sources
- **Appointments/Bills** → typed data extracted from items
- **Audit** → classification and parsing decisions for review

### Key Relationships

- Each user gets a unique email forwarding address (format: `user-{id}-{token}@{domain}`)
- Each source triggers a parse job that creates items
- Items are classified as appointment, bill, or noise with confidence scores
- Low confidence items (<0.7) are flagged for manual review in audit logs
- ICS tokens are unique per appointment for calendar downloads
- Plan secret tokens allow sharing weekly plan with family

## Core Workflows

### Email Intake Flow

1. User forwards emails to their unique forwarding address
2. Postmark webhook receives: From, To, Subject, TextBody, MessageID
3. Find user by forwarding address → get recipient_id
4. Store short excerpt (first 500 chars) in database
5. Store full text in storage if >500 chars
6. Create source record
7. Parse source and create item + appointment/bill

### Photo Upload Flow

1. User uploads image (5MB max, images only)
2. Call Google Cloud Vision OCR to extract text
3. Store short excerpt from OCR results
4. Create source record
5. Parse source and create item + bill

### Parsing Pipeline

The parser in `src/services/parser.js` uses rules-based classification:

1. **Classification** (`classifyText`):
   - Count keyword matches for appointments and bills
   - Check for time, date, and money patterns with regex
   - Calculate confidence scores
   - Return type (appointment/bill/noise) and confidence

2. **Extraction** (`extractAppointment` or `extractBill`):
   - Use regex patterns to extract structured data
   - For appointments: date, time, location, prep notes
   - For bills: amount, due date, statement date, payment URL

3. **Create Records**:
   - Create item with classification type and confidence
   - Create child record (appointment or bill)
   - Write audit log with decision details

4. **Flag for Review**:
   - Items with confidence <0.7 are logged for manual review

### Plan Page

- Shows next 7 days for active recipient
- Two sections: **Show Up** (appointments) and **Pay** (bills)
- Appointments display: when, where, prep notes, "Add to Calendar" button
- Bills display: amount, due date, status badge, "Pay Now" button
- Dual access: authenticated users OR secret token in query string (`?token=`)
- Read-only (no editing capability)

### Calendar Integration

- Each appointment gets unique ICS token on creation
- ICS files generated on-demand at `/calendar/:token.ics`
- Files include: summary, location, start/end times, description
- Users can add to any calendar app (Google, Apple, Outlook, etc.)
- No calendar write scopes required

### Friday Digest

- Cron job runs Fridays at 9 AM (timezone-aware)
- Queries all users and their upcoming appointments/bills
- Generates HTML email with summary
- Sends via Postmark
- Includes link to plan page with secret token

## Privacy & Security Requirements

- **Minimal data storage**: Only sender, subject, short excerpt, message ID/storage key
- **Token protection**: ICS tokens and plan secrets are random, unguessable
- **Encrypted at rest**: Sensitive tokens and phone numbers encrypted in database
- **Account deletion**: CASCADE deletes remove all user data immediately
- **File cleanup**: Uploaded files deleted within 24 hours of account deletion
- **No calendar write access**: ICS files only, never request calendar modification scopes
- **Session security**: httpOnly cookies, secure in production, trust proxy for Railway

## Key Technical Constraints

- **Calendar integration**: ICS files only, no calendar write scopes
- **Email provider**: Postmark (supports both inbound webhooks and outbound sending)
- **OCR**: Google Cloud Vision API (optional for MVP)
- **Time zones**: Timestamps stored without timezone, assumes local time
- **File storage**: Local filesystem for MVP (migrate to S3/R2 for production)
- **Session storage**: In-memory for MVP (migrate to Redis for production)

## Important Implementation Details

### Proxy Trust (Railway Deployment)

Railway runs behind a proxy, so session cookies require proper configuration:

```javascript
// In src/server.js
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // HTTPS only in production
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));
```

Without `trust proxy`, users will experience infinite login loops in production.

### Postmark Webhook Format

The webhook handler supports both Postmark (capitalized) and Resend (lowercase) formats:

```javascript
const from = req.body.From || req.body.from;
const to = req.body.To || req.body.to;
const subject = req.body.Subject || req.body.subject;
const text = req.body.TextBody || req.body.text;
const messageId = req.body.MessageID || req.body.messageId;
```

### Parser Regex Patterns

Location extraction requires word boundaries to avoid matching "at" inside other words:

```javascript
// CORRECT - requires word boundary around "at"
const locationMatch = combined.match(/(?:location:|address:|(?:^|\s)at\s)\s*([^\n]{10,80})/i);

// WRONG - matches "at" inside "Date:"
const locationMatch = combined.match(/(?:at|location:|address:)\s*([^\n]{10,80})/i);
```

## Success Metrics (Weekly)

1. Auto capture hit rate (target: 60%+)
2. On-time bill payment rate (target: 90%+)
3. Missed appointment rate
4. Weekly active rate (plan or digest opens)
5. Referral share rate

## Launch Gates

Must achieve before general launch:

1. Two real families used product for 2+ weeks
2. 60%+ auto capture rate without manual review
3. 90%+ bills paid by due date
4. Families confirm reduced coordination time

## Acceptance Tests Required

All implementations must pass these tests:

1. Sign in creates user and recipient record
2. Clinic email → appointment with valid ICS link on plan page
3. Billing email → bill with amount, due date, pay link on plan page
4. Photo upload → OCR → bill on plan page
5. Friday digest sends email with next week's plan + link
6. Delete account removes all data and returns to landing page

## Development Notes

- Keep parsing rules simple and auditable (rules-based, not ML initially)
- Build with expectation that mobile app will follow web MVP
- Pilot with 2 seed users before real families
- Monitor audit logs closely for low confidence items during pilot
- Always commit after significant changes
- Keep implementations simple - easier to add complexity than remove it
- Test coverage required for all new features
- Consider trade-offs before big decisions
- Don't change unrelated code
