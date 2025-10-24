# Clerk Setup Checklist

This document covers the one-time provisioning work required before the Clerk migration phases begin. Keep it up to date as environments change.

## 1. Create Clerk Instances
- Create three Clerk instances: development, staging, production.
- Enable the following sign-in methods on each instance:
  - Email + password
  - Magic link (email)
  - Google OAuth
  - Facebook OAuth
  - Apple Sign In
- Turn on universal audit logs and set data residency to the preferred region (e.g. `us`).
- Enable multi-factor authentication with TOTP required and SMS as a backup factor.

## 2. Configure OAuth Providers
- For every provider (Google, Facebook, Apple):
  - Register the OAuth app with the correct redirect URIs (Clerk dashboard lists them).
  - Copy client ID/secret into the Clerk dashboard.
  - Verify the provider connection with a test user.

## 3. Generate Environment Keys
- From each Clerk instance, generate a `Secret Key` and `Publishable Key`.
- Store the keys in the respective environment files:
  - `env.development.local` / `.example`
  - `env.production.local` / `.example`
  - `mobile/.env.development.local` / `.example`
  - `mobile/.env.production.local` / `.example`
- If the backend will validate JWTs with a custom template, create the template and note its name (default `carebase-backend`).
- Generate a signed webhook secret (`CLERK_WEBHOOK_SECRET`) for user lifecycle events and add it to backend env files (development/staging/production). The server uses this secret to verify requests on `/webhook/clerk`.

## 4. Hosted UI URLs
- Copy the hosted sign-in and sign-up URLs from Clerk and place them in the env files if the defaults differ per environment.
- Confirm that the URLs resolve correctly when accessed in a browser.

## 5. Clerk Management API
- Generate API keys with `User management` permissions for backfill scripts.
- Store them securely (1Password) and populate the `CLERK_SECRET_KEY` env variable when running the backfill.

## 6. Track Decisions
- Document MFA grace period policy (owners must enroll before grace period expires; contributors optional).
- Maintain a list of any deviations from this checklist in `docs/security.md`.
