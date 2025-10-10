# Carebase

Healthcare coordination platform that transforms emails and photos into a weekly plan: **Show Up** (appointments) and **Pay** (bills). Zero typing after setup.

## Core Principles

- **Zero typing**: Auto-capture from forwarded emails and photos
- **Privacy first**: Minimal data storage, clean deletion
- **Auto-capture target**: 60%+ success rate without manual review
- **Simple scope**: Just appointments and bills, nothing more

## Tech Stack (Monorepo)

```
backend/     - Node.js + Express + TypeScript + PostgreSQL
mobile/      - React Native + Expo (in development)
shared/      - Shared TypeScript types
```

**Backend**: Express, PostgreSQL, Passport (Google OAuth), Postmark (email), Google Cloud Vision (OCR)
**Mobile**: React Native, Expo, TypeScript

## Data Model

Users → Recipients → Sources (email/upload) → Items (classified) → Appointments/Bills

- Each user gets unique forwarding address: `user-{id}-{token}@domain.com`
- Items classified with confidence scores
- Low confidence (<0.7) flagged for review
- ICS tokens per appointment, plan secret tokens for sharing

## Key Workflows

### Email Intake
1. User forwards email → Postmark webhook
2. Find user by forwarding address
3. Store excerpt (first 500 chars) + optional full text
4. Parse → classify as appointment/bill/noise
5. Extract structured data (dates, amounts, locations)
6. Create appointment or bill record

### Photo Upload
1. Upload image → Google Cloud Vision OCR
2. Extract text → parse → create bill

### Parser Logic
- **Rules-based** (no ML): keyword matching + regex patterns
- Classifies as: appointment, bill, or noise
- Extracts: dates, times, amounts, locations, prep notes
- Returns confidence score (0.0-1.0)

## Important Details

### Proxy Trust (Railway)
Railway requires `app.set('trust proxy', 1)` for HTTPS cookies. Without this, infinite login loops.

### TypeScript + ES Modules
- All imports use `.js` extensions (required for TypeScript + ESM)
- Shared types from `@carebase/shared`
- Database queries convert snake_case → camelCase

### Parser Gotchas
Word boundaries matter:
```typescript
// ✅ Good - won't match "Date:"
/(?:^|\s)at\s/

// ❌ Bad - matches "at" inside "Date:"
/at\s/
```

## Launch Gates

1. 2 families use for 2+ weeks
2. 60%+ auto-capture rate
3. 90%+ bills paid on time
4. Families confirm time saved

## Development Rules

- Keep simple (can always add complexity later)
- Commit after changes
- Test coverage for all features
- Don't change unrelated code
- Consider trade-offs before big decisions
- never start expo bash process