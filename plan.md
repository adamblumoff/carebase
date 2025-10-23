# Clerk Migration Plan

## Phase 0 – Foundations & Access
- Provision Clerk instances (dev/staging/prod) with required sign-in methods: email + password, magic link, Google, Facebook, Apple.
- Enable audit logs, data residency, TOTP + SMS MFA factors in Clerk dashboard.
- Generate and store environment variables (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, etc.) in env templates.
- Document OAuth provider setup in Clerk (redirect URIs, scopes).

## Phase 1 – Database & Model Prep
- Migration 1: add `clerk_user_id TEXT UNIQUE`, `legacy_google_id TEXT`, `password_reset_required BOOLEAN DEFAULT false` to `users`. Copy existing `google_id` to `legacy_google_id` and allow `google_id` to be nullable.
- Migration 2: create `users_mfa_status` table with MFA status enum (`pending`, `grace`, `required`, `enrolled`) and timestamps.
- Update `backend/src/db/queries/users.ts` to expose helpers for lookup by `clerk_user_id` and manage MFA status flags.
- ✅ Implemented in repo (2025-10-23). Requires running latest DB migration locally (`npm run db:migrate --workspace=backend`) so new columns/table exist.

## Phase 2 – Clerk Backfill & Flagging
- Implement `backend/scripts/backfill-clerk-users.ts` to upsert all users into Clerk via Management API.
- For each user: create/sync Clerk user, attach OAuth identity when `legacy_google_id` exists, set `password_reset_required` in both Clerk and local DB.
- Mirror local roles into Clerk `publicMetadata.roles`.
- Run script with dry-run mode in dev, then apply in staging, and finally prod during maintenance window.
- ✅ Script scaffolded (`backend/scripts/backfill-clerk-users.ts`); dry-run by default, use `--apply` when ready. Handles role metadata + password-reset flag. OAuth identity linking still pending (will require dedicated flow once Clerk tokens are available).
- ✅ Added `backend/scripts/mark-clerk-google-relink.ts` to flag accounts missing Clerk Google OAuth, plus `docs/clerk-google-relink.md` describing the re-link rollout plan.

## Phase 3 – Dual-Auth Bridge (Temporary)
- Introduce middleware that accepts legacy sessions/mobile tokens or Clerk tokens.
- When legacy auth is detected, create a Clerk session (`clerkClient.sessions.create`) and mark user as needing password reset.
- Instrument metrics/logging to measure remaining legacy traffic.
- 🔄 In progress: Backend now mints Clerk sessions during mobile login, bearer middleware + Socket.IO accept Clerk JWTs, and bridge events are logged; metrics aggregation/dashboarding still TBD.

## Phase 4 – Backend Session Refactor
- Replace Express session + Passport with Clerk middleware (`ClerkExpressWithAuth`).
- Update controllers/services to resolve local users via `clerk_user_id` and attach to `req.user`.
- Update Socket.IO auth to validate Clerk session JWTs.
- Deprecate `mobileTokenService` issuance while bridge is active; keep verification until cutover.
- ✅ Prep work: Bearer + Socket.IO already honor Clerk tokens; metrics/logging in place.
- Next steps:
  1. ✅ Define hard-cutover scope with product (Clerk-only auth, legacy tokens removed).
  2. ✅ Phase 4A – Replace Express session + Passport (2025-10-23):
     - Removed session + Passport middleware from HTTP/Socket.IO; deleted legacy `/auth` routes.
     - Clerk middleware now stands alone; `attachBearerUser` continues to populate `req.user`.
     - Verified env/docs trimmed of `SESSION_SECRET` + session store guidance.
  3. ✅ Phase 4B – Remove legacy mobile token flow (2025-10-23):
     - Deleted mobile token utilities + routes, refreshed docs/metadata, and renamed metrics to `auth.clerk.*`.
     - REST + realtime layers now trust only Clerk tokens; env/docs shed `MOBILE_AUTH_SECRET` references.
  4. ✅ Phase 4C – Clean up residual Passport artifacts (2025-10-23):
     - Scrubbed env/docs of legacy `/auth/google` flows, regenerated route docs, and tightened middleware guards.
     - `ensureAuthenticated` now checks `req.user`; web redirects replaced with 401 for consistency.
  5. ✅ Phase 4D – Final verification (2025-10-23):
     - Backend + contract suites passing; pg-mem schema shim updated to skip legacy migration backfill.
     - Manual smoke test confirmed Clerk session token authenticates REST + Socket.IO against running backend.
     - Monitoring: follow `auth.clerk.http`/`auth.clerk.socket` counters; bridge metrics removed.

## Phase 5 – Mobile App Migration
- Integrate Clerk Expo SDK with hosted components.
- Wrap app in `ClerkProvider` and update API client to send Clerk session tokens.
- Remove legacy mobile login flow and ensure SecureStore still holds app-specific secrets.
- ✅ Phase ready: backend now Clerk-only; mobile must stop relying on legacy tokens.
- Execution steps:
  1. Phase 5A – Clerk provider & env wiring:
     - Add `@clerk/clerk-expo` dependency and env keys to templates.
     - Introduce `ClerkProvider` in `App.tsx` with publishable key + token cache helper.
     - Bridge Clerk token retrieval via a shared module for API interceptors.
  2. Phase 5B – API client + auth services:
     - Rework Axios interceptors to fetch Clerk session tokens.
     - Emit unauthorized events by calling Clerk `signOut` fallback when needed.
     - Update API-layer tests/mocks for the new token fetcher.
  3. Phase 5C – Auth context & session bootstrap:
     - Refactor `AuthProvider` to derive status from Clerk `useAuth` and hydrate backend session data.
     - Ensure logout delegates to Clerk and clears collaborator/plan state as needed.
     - Update hooks/tests relying on old sign-in semantics.
  4. Phase 5D – UI flows & smoke tests:
     - Remove legacy token storage helpers and replace `LoginScreen` with Clerk hosted sign-in (email/password/link + Google/Facebook/Apple).
     - Remove deep link mobile-login exchange; ensure invite flow still works.
     - Run Expo Vitest suite and manual sign-in smoke test.

## Phase 6 – Web Frontend (if applicable)
- Replace existing web auth UI with Clerk hosted sign-in/up components.
- Ensure API calls use Clerk session tokens.

## Phase 7 – Google Sync & Integrations Alignment
- Resolve Google credential ownership via `clerk_user_id` → local `user.id`.
- Enforce MFA grace policy before allowing Google OAuth linking.
- Confirm encryption/storage remain unchanged and cleanup cascades on user deletion.

## Phase 8 – Testing & Validation
- Update backend tests to mock Clerk auth context and cover MFA grace logic.
- Adjust contract and mobile tests to operate with Clerk tokens.
- Manual QA checklist: login flows, password reset, MFA enrollment, Google calendar sync, realtime sockets, contributor invites.
- ✅ Smoke test complete: Clerk session tokens authenticate REST + Socket.IO; metrics confirm `auth.bridge.http/socket` paths. Re-link script dry run flagged legacy users.
- 📝 Next: migrate controllers to rely on Clerk context, then retire legacy sessions (Phase 4).

## Phase 9 – Cutover & Cleanup
- Schedule maintenance window; deploy backend changes, run migrations, execute backfill script.
- Release mobile build with Clerk integration; coordinate rollout.
- Remove bridge middleware, drop `google_id`, delete `user_sessions` table if unused, and retire legacy auth code.
- Update documentation, env templates, and communicate MFA grace expectations.
