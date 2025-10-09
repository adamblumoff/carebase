# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Inbox to Week is a healthcare coordination web app that transforms emails and photos into a weekly plan with two primary actions: Pay and Show up. The goal is zero typing after setup, with calendar integration through ICS files only.

## Core Product Principles

- **Minimal scope**: Keep the MVP tiny, build trust first before expanding
- **Zero typing**: After initial setup, users should not need to type anything
- **Privacy first**: Store minimal email content, encrypt sensitive data at rest, provide clean account deletion
- **Auto-capture focus**: Success is measured by how much can be automatically captured without manual review (target: 60%+ hit rate)

## Data Model Architecture

The system uses a hierarchical structure:
- **Users** → authenticated via Google OAuth (profile scope only)
- **Recipients** → care recipients (one default per user initially)
- **Sources** → intake points (email or photo upload)
- **Items** → classified entries linking to sources
- **Appointments/Bills** → typed data extracted from items
- **Audit** → classification and parsing decisions for review

Key relationships:
- Each user gets a unique email forwarding address
- Each source triggers a parse job that creates items
- Items are classified as appointment, bill, or noise with confidence scores
- Low confidence items are flagged for manual review

## Core Workflows

### Email Intake Flow
1. User forwards emails to their unique address
2. Inbound webhook receives sender, subject, plain text body
3. Store short excerpt + storage key for larger bodies
4. Create source row → enqueue parse job

### Photo Upload Flow
1. User uploads image (with tight size cap)
2. Call OCR service
3. Extract first lines as short excerpt
4. Create source row → enqueue parse job

### Parsing Pipeline
1. Rules-based classifier (checks date words, time expressions, money amounts, common phrases)
2. Extract structured data based on type
3. Create item + child record (appointment or bill)
4. Write audit log with confidence score
5. Flag low confidence for manual review

### Plan Page
- Shows next 7 days for active recipient
- Two sections only: Appointments (time, location, prep, Add to calendar) and Bills (amount, due date, status, Pay link)
- Accepts secret token in URL for family sharing
- Read-only (no editing)

## Privacy & Security Requirements

- Store minimal email content: sender, subject, short excerpt, message ID or storage key
- Uploads private with signed access only
- Encrypt tokens and phone numbers at rest
- Account deletion removes all user data and files within 24 hours
- Log only necessary analytics: created appointment, created bill, opened digest, plan page view

## Key Technical Constraints

- **Calendar integration**: ICS files only, no calendar write scopes
- **Email provider**: Must support inbound webhooks and outbound sending
- **OCR**: External service required for photo bill processing
- **Time zones**: Handle local time correctly for appointments and Friday digest scheduling
- **File storage**: Private object storage for uploads and large text blobs

## Success Metrics (Weekly)

1. Auto capture hit rate (target: 60%+)
2. On-time bill payment rate (target: 90%+)
3. Missed visit rate
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
