# Plan: Fix OAuth Sign-In Regression After Clerk Account Reset

## Context
- New users completing Google OAuth on mobile get `You're already signed in` from Clerk, stay on the login screen, and only reach the plan page after restarting the app.
- The OAuth handler in `mobile/src/screens/LoginScreen.tsx` only continues when `startOAuthFlow()` returns a `createdSessionId`, so it treats “session already active” responses as failures.
- `autoCompleteSignUp` calls `signUp.create({ transfer: true })` even when Clerk has already activated the session, which raises the blocking error.

We need to treat the existing-session response as success, fall back to the active Clerk session ID, and stop running the redundant sign-up completion.

---

## Step 1 — Confirm Current Behavior
1. Reproduce on simulator: delete Clerk user, run Google OAuth, observe logs and empty `createdSessionId`.
2. Inspect the `result` payload shape for both first-run and restart flows to document the values we can rely on (`createdSessionId === ''`, `setActive`, etc.).

## Step 2 — Update Login Flow Logic
1. Modify `finishSignIn` to accept a fallback session resolver (e.g., explicitly fetch `clerkAuth.sessionId` when the provided id is falsy).
2. In `handleOAuth`:
   - Short-circuit success when `result.setActive` exists and Clerk reports `isSignedIn` (call `finishSignIn` with fallback).
   - Handle errors whose message/code indicate “already signed in” by treating them as success instead of failure.
   - Only invoke `autoCompleteSignUp` when Clerk still needs more fields (no active session yet).
3. Guard `autoCompleteSignUp` so it skips `create({ transfer: true })` if the resource reports `createdSessionId` or if Clerk is already signed in.

## Step 3 — Add Regression Coverage
1. Add a unit test (or lightweight integration test) around the login helper to simulate the OAuth response object with `createdSessionId: ''` and `clerkAuth.isSignedIn = true`, ensuring we call `auth.signIn()`.
2. Add a test for the “already signed in” error path to confirm we no longer surface an error toast.

## Step 4 — Verification
1. Run `npm run test --workspace=mobile`.
2. Manually run the OAuth flow again to confirm the user lands on the plan page immediately and no “already signed in” errors appear.
3. Confirm the restart flow remains unchanged.

## Risks & Mitigations
- *Risk*: Handling an unexpected Clerk error as success could mask real failures. **Mitigation**: gate the success fallback on specific error codes/messages (`session_exists`, `'You're already signed in'`).
- *Risk*: New logic relies on `clerkAuth.sessionId` which might be undefined briefly. **Mitigation**: catch and retry `auth.signIn()` if the session fetch fails, emitting a soft error message.
