# Clerk Google Identity Re-Link Plan

## Objective
Ensure every historical CareBase user who previously connected Google Calendar remains linked after migrating to Clerk. We cannot import Google OAuth refresh tokens directly into Clerk, so we must prompt users to re-authorize via the new Clerk-hosted flow while preserving existing data.

## Strategy Overview
1. **Detect legacy linkage**
   - `google_credentials` rows indicate an active CareBase-managed integration.
   - Clerk public metadata already records `googleConnected` as part of the backfill.
   - Introduce a Clerk metadata flag (`carebase.googleReauthRequired`) when we detect a legacy link without a Clerk Google external account.

2. **Initiate re-auth on next login**
   - When mobile/web clients exchange login (or fetch session), surface `needsGoogleReauth=true` if the flag is present.
   - UI prompts the caregiver to reconnect the calendar; CTA launches the new Clerk OAuth flow.

3. **Complete the re-link**
   - After Clerk OAuth succeeds, `clerk` sends a web hook or the client posts back to the API.
   - Backend consumes Clerk user data, ensures the Google external account exists, and removes the `googleReauthRequired` flag.
   - Existing `google_credentials` continue to store encrypted refresh tokens; once the new Clerk tokens are in place we can optionally migrate storage later.

4. **Graceful fallback**
   - Until re-auth occurs, we keep using the legacy tokens and continue syncing.
   - If tokens expire, we pause syncing and surface alerts in both UI + Clerk metadata (`carebase.googleSync.status = 'needs_reauth'`).

## Implementation Tasks
1. **Metadata utilities**
   - Extend `clerkSyncService` to read/write `googleReauthRequired` and `googleSyncStatus` flags.
2. **Detection job**
   - New script `backend/scripts/mark-clerk-google-relink.ts` queries `google_credentials` and Clerk users.
   - For each user missing a Clerk Google external account, set `googleReauthRequired=true`.
3. **API exposure**
   - Update `/api/auth/session` to include `needsGoogleReauth` flag when present.
4. **Client UX**
   - Mobile/Web: show banner prompting re-auth, link to Clerk OAuth screen.
5. **Post-auth cleanup**
   - After successful reconnect (Clerk webhook or callback endpoint), clear the flag and log metrics.
6. **Monitoring**
   - Track counts via metrics (`clerk.google.reauth_required`, `clerk.google.reauth_completed`).

## Non-Goals (for now)
- Migrating refresh tokens into Clerk (not supported).
- Forcing re-auth on login; we rely on progressive prompts to avoid blocking access.
