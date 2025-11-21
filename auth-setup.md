# Custom Auth Flows (Clerk + Expo Router + NativeWind)

## Goals (Google-only)
- Provide Google Sign-In via Clerk (federated), no password or email OTP flows.
- Keep unauth users in `(auth)`; route authed users to `(home)`.
- Reuse minimal UI pieces; neutral styling; iOS-first polish.

## Routes & Navigation
- Auth stack: `/(auth)/sign-in` (Google button only). No sign-up/forgot-password screens.
- Authed stack: `(home)` routes only.
- Auth gate in `app/_layout.tsx`:
  - if !isSignedIn and not in `(auth)`, `router.replace('/sign-in')`
  - if isSignedIn and in `(auth)`, `router.replace('/')`
  - wait for `isLoaded` before routing.
- Use `router.replace('/')` after successful Google sign-in.

## Screens
- **Sign In:** single “Continue with Google” button using Clerk’s Google strategy. Show loading + error text. No password fields, no sign-up route.
- **Sign Out:** `SignOutButton` calls `signOut()` then `router.replace('/sign-in')`.

## Clerk Logic (Google)
- Sign In: `useSignIn()` → `signIn.create({ strategy: 'oauth_google' })`; use returned `firstFactorVerification` session workflow; on complete, `setActive` then `router.replace('/')`.
- Sign Up: not exposed; rely on Google account creation via Clerk.
- Errors: surface `err.errors?.[0]?.message ?? 'Something went wrong'`; log details.
- Guards: gate actions on `isLoaded`; disable button while awaiting.

## UI Components to Create
- `PrimaryButton` (loading state) styled neutral.
- `ErrorBanner`.
- `AuthLayout` wrapper (padding/logo/bg) for sign-in page.

## File Structure
- `app/(auth)/sign-in.tsx` — Google button only.
- `components/auth/` — shared button + banner + layout.
- `components/SignOutButton.tsx` — sign out + redirect.
- `app/_layout.tsx` — keep auth gate, wait on `isLoaded`.

## Testing
- Integration (Maestro/Detox): Google sign-in happy path to `(home)`; sign out returns to `/sign-in`.

## Next Actions
1) Scaffold `components/auth` (inputs, button, banner, layout).
2) Implement `sign-in.tsx` with validation/loading/error.
3) Implement `sign-up.tsx` with 2-step + resend timer.
4) Wire `SignOutButton` into `(home)` screens.
5) Run e2e smoke once flows are wired.
