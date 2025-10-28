# Plan: Add Session Retry UX

## Goal
Provide a graceful retry path when `checkSession()` fails during app bootstrap so users aren’t stuck at the login screen due to transient backend or Clerk hiccups.

## Step 1 — Track Session Failures in Auth Context
1. Extend `AuthProvider` state with:
   - `status` gains an `'error'` variant for bootstrap failures.
   - `lastError` string to display a friendly message.
   - `pendingRetry` flag to block repeated manual retries while auto-retry runs.
2. Update `loadSessionUser` to:
   - On initial failure, set `status = 'error'`, store the error, and kick off a one-time retry after ~2s.
   - On retry success, clear the error and revert to the regular `'signedIn'` / `'signedOut'` states.
   - Expose a new `retrySession()` function on the context that callers can invoke after the auto-retry completes.

## Step 2 — Surface the Error UI in App Shell
1. Update `AppContent` in `mobile/App.tsx` to render a `RetrySplash` component when `auth.status === 'error'`.
2. `RetrySplash` shows:
   - Spinner + “Trying again…” while `pendingRetry` is true.
   - Friendly copy describing the failure and a `Try again` button (disabled until `pendingRetry` clears) that calls `auth.retrySession()`.
   - Optional “Sign out” action to clear Clerk if retries keep failing.

## Step 3 — Regression Coverage
1. Extend `AuthContext` unit tests to cover:
   - Initial failure moves to `'error'` and triggers auto retry.
   - Auto retry success transitions back to `'signedIn'`.
   - Double failure keeps `'error'` and allows manual retry.
2. Add a simple render test for the new `RetrySplash` UI showing spinner vs. button states.

## Step 4 — Verification
1. Run `npm run test --workspace=mobile` after each step.
2. Manual QA: simulate backend failure (e.g., point `API_BASE_URL` to invalid host), confirm retry UI appears, auto retry triggers once, and manual retry works when backend fixed.

## Risks & Mitigations
- *Risk*: Infinite retry loop if the error never clears. **Mitigation**: single auto retry, manual retries only on user action.
- *Risk*: Ambiguous messaging for auth vs. network errors. **Mitigation**: log raw error for debugging, show generic “temporary issue” copy to users.
