# Operations Runbook

## Background jobs
- **Medication reset**: Runs in-process when `WORKER_ENABLED=true` (or `ROLE=worker`). Interval set by `MEDICATION_RESET_INTERVAL_MS` (default 15m). Skips entirely when `MEDICATION_RESET_ENABLED=false`. Logs `Starting reset run` / `Completed reset run`; metrics `job.medication_reset.run` and `job.medication_reset.created` are emitted per cycle.
- **Google sync polling**: Only starts when `WORKER_ENABLED=true` and `GOOGLE_SYNC_POLLING_ENABLED=true`. Keep only one worker replica running these jobs to avoid double-processing.

## Webhooks
- **Google Calendar**: Incoming watch notifications must include `x-goog-channel-token` that matches the stored `google_watch_channels.channel_token`. If notifications are ignored, check that tokens were provisioned and consider rebuilding watches:
  1) Stop workers (`WORKER_ENABLED=false`) to halt scheduling.
  2) Clear stale watches: `DELETE FROM google_watch_channels;`.
  3) Re-enable workers; the next manual sync will recreate watches with fresh tokens.
- **Inbound email**: Rate limiting defaults to 30 req/min/window. Buckets are pruned each request; adjust with `INBOUND_WEBHOOK_RATE_LIMIT` if needed.

## Auth & Clerk
- **Token cache**: In-memory cache clears on restart. To force a refresh at runtime, deploy a restart or use a debug endpoint that calls `clearClerkTokenCache` (not exposed publicly).
- **JWKS**: Configure `CLERK_JWKS_ISSUER` and refresh intervals (`CLERK_JWKS_REFRESH_INTERVAL_MS`, `CLERK_JWKS_PREFETCH_TIMEOUT_MS`) for faster cold starts.

## Mobile device data
- Plan cache now prefers `expo-secure-store`; AsyncStorage is used only as a fallback. If a device is lost, revoke tokens via Clerk; cached plans are encrypted where SecureStore is available.

## Database & schema
- `backend/src/db/schema.sql` is the source of truth. Runtime bootstraps still run for collaborators/Google tables but should align with the schema. Run `npm run db:migrate --workspace=backend` after schema edits and before deploys.

## Quick diagnostics
- **Health**: `GET /health` returns `{status:'ok'}`; backend logs env file loading on boot.
- **Medication reset sanity**: Check recent logs for `MedicationReset` and the `job.medication_reset.*` metrics; verify new pending intakes exist for tomorrow in `medication_intakes`.
- **Google webhook drift**: Count pending watches: `SELECT COUNT(*) FROM google_watch_channels;` and look for null tokens (should be zero).
