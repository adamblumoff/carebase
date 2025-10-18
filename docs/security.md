# Security Posture – October 2025

This document tracks the security controls currently in place across the Carebase backend and mobile app, along with the highest-impact improvements still on our roadmap.

## Implemented Controls

- **Mandatory Secrets & Config Guardrails**
  - Backend boot fails fast if any critical secret is missing (`SESSION_SECRET`, `MOBILE_AUTH_SECRET`, `GOOGLE_AUTH_STATE_SECRET`, `GOOGLE_CREDENTIALS_ENCRYPTION_KEY`, Google OAuth creds, `DATABASE_URL`).
  - OCR service account keys now load from the `OCR_SERVICE_ACCOUNT_JSON` env secret (base64 or raw JSON), eliminating the need to ship credential files.
  - Deterministic test-only secrets prevent suites from polluting real values.

- **Session Hardening**
  - Express sessions persist in Postgres via `connect-pg-simple`, enabling horizontal scaling.
  - Cookies are `httpOnly`, `sameSite=strict`, and marked `secure` in production.

- **Database Transport Security**
  - TLS enforced by default; provide the Railway CA via `DATABASE_SSL_CA` or `DATABASE_SSL_CA_BASE64` so we keep `rejectUnauthorized: true`.
  - SQL logging now opt-in (`DEBUG_SQL=true`) to reduce PII leakage in shared logs.

- **Google OAuth Credential Protection**
  - OAuth tokens are encrypted at rest with AES‑256‑GCM (automatic re-encryption for legacy plaintext rows).
  - Google sync tests go through the same encryption helpers to keep parity.

- **Webhook Integrity & Abuse Guardrails**
  - Postmark and Resend inbound email webhooks require HMAC signatures (request rejected if absent/invalid).
  - Lightweight rate limiter (default 30 req/min per source) blocks brute-force or malformed submissions.
  - Raw request bodies captured for signature validation without increasing body size limits (1 MB cap).

- **File Storage Hardening**
  - Uploaded files use sanitized, random filenames; retrieval defends against path traversal and legacy key formats.

- **Reduced Sensitive Logging**
  - Bearer tokens and sync payloads avoid landing in logs; Google sync uses structured info logging only.

- **Mobile Token Storage**
  - Access tokens stored in Expo SecureStore when available, falling back to AsyncStorage with automatic migration.
  - API client and realtime socket pull tokens exclusively through the secure storage helper.

- **Documentation & Tooling**
  - `AGENTS.md` and env examples detail required secrets, TLS setup, and webhook keys.
  - Tests updated to cover new security paths (token encryption, secure storage).

## High-Impact Next Steps

1. **Credential Rotation & Key Management**
   - Define automated rotation (and re-encryption) for `GOOGLE_CREDENTIALS_ENCRYPTION_KEY`, session secrets, and mobile JWT secrets.
   - Add runbooks and ideally one-click scripts to rotate and redeploy safely.

2. **Centralized Secrets Vault**
  - Move production secrets out of `.env` files into a managed secrets platform (e.g., 1Password SCIM, AWS Secrets Manager, Doppler).
  - Integrate the vault with Railway build-time env injection to minimize manual handling.

3. **Monitoring & Alerting**
  - Instrument alerts for webhook signature failures, repeated Google sync 410 loops, bearer-auth errors, and rate-limit hits.
  - Pipe critical logs to an alerting system (PagerDuty/Slack) with actionable context.

4. **Dependency Security Automation**
  - Enable Dependabot or Renovate for all workspaces and tie in vulnerability scanning (npm audit/Snyk) to CI.
  - Add policy checks preventing production deploys when high-severity advisories are open.

5. **Least-Privilege Database Roles**
  - Split Postgres roles (app vs. session store vs. analytics) and scope privileges to the minimum required.
  - Evaluate row-level permissions for collaborator data to isolate tenants further.

6. **Infrastructure Policies**
  - Enforce HTTPS + HSTS on carebase.dev and API endpoints (if not already managed by CDN/proxy).
  - Document and periodically review IP allowlists for inbound webhooks if providers support it.

Completing these items will elevate the security posture from a solid “B” to A‑range, while keeping day-to-day operations manageable. Track progress here and update as controls land.***
