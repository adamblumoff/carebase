# Security Hardening Plan — Clerk Auth & PII Logging

## Context
- `verifyClerkSessionToken` currently trusts decoded JWT payloads whenever both JWKS verification and the Clerk session API fail (timeouts, 404/403). Unit tests (`backend/src/services/__tests__/clerkAuthGateway.vitest.test.ts`) confirm this fallback was added so requests continue to work when Clerk is unavailable. The relaxed path caches the token and exposes a privilege-escalation risk.
- Multiple auth- and upload-related modules log raw JWT payloads, session identifiers, and OCR text snippets (`clerkAuthGateway.ts`, `attachBearerUser.ts`, `controllers/api/upload.ts`). These logs leak sensitive data into stdout/observability pipelines.

We will tighten verification and strip the high-risk logs, ensuring downstream callers still handle null/unauthenticated responses gracefully.

---

## Workstream 1 — Remove Insecure Clerk Token Fallback
1. **Baseline & Discovery**
   - Run targeted tests: `npm run test --workspace=backend -- clerkAuthGateway.vitest.test.ts` to document current behavior.
   - Inspect call sites (`attachBearerUser`, `services/realtime`) to confirm they already degrade to “unauthenticated” when verification returns `null`.
   - Capture any ancillary tooling (scripts, docs) referencing the relaxed behavior (search for “fallback” / “handshake token” comments).
2. **Design Guardrails**
   - Decide on new policy: only accept tokens when JWKS verification or Clerk API verification succeeds.
   - Determine metric/logging adjustments (e.g., keep `incrementMetric('clerk.token.verify', …)` for failed paths, but no user-identifying logs).
   - Draft update notes for the team explaining that Clerk outages will now surface as 401 responses rather than silent fallback.
3. **Implementation**
   - Update `verifyClerkSessionToken` to return `null` on JWKS failure if `sessions.verifySession` rejects (for any status) or times out; remove the decoded-token fallback and corresponding cache writes.
   - Ensure we still clear cache entries on failure and preserve timeout/error metrics.
   - Remove/adjust `console.log` statements that emit decoded payloads or session metadata.
4. **Automated Test Updates**
   - Rewrite affected unit tests to match the stricter behavior (timeout/404 cases should now expect `null` and no cache writes).
   - Add a regression test that proves forged tokens are rejected (e.g., decoded payload present but unverifiable).
   - Update middleware/realtime tests if they assumed fallback success; ensure they assert `verifyClerkSessionToken` returning `null` results in `next()` without user context.
5. **Verification Sweep**
   - Run `npm run test:backend` and `npm run test:contracts` to cover both unit/integration and API contract suites.
   - Manually exercise a local flow (e.g., hitting `/api/plan` with a known-good token and a tampered token) to confirm accepted vs. rejected behavior.
   - Review logs/metrics in development to ensure failure paths remain observable without leaking PII.
6. **Documentation & Rollout**
   - Note the behavior change in `docs/architecture.md` or a CHANGELOG entry so operators know Clerk downtime will now surface as 401.
   - Coordinate with anyone relying on the previous relaxed behavior (e.g., QA tools) so they refresh their tokens instead of expecting fallback acceptance.

**Risks & Mitigations**
- *Risk*: Legitimate clients see more 401s during Clerk outages. **Mitigation**: Communicate change, ensure monitoring catches spikes, and possibly add retry/backoff on the mobile client.
- *Risk*: Tests or tooling that stubbed `verifyClerkSessionToken` to rely on fallback break. **Mitigation**: Update fixtures and document the new contract (verified or null).

---

## Workstream 2 — Strip Sensitive Authentication & OCR Logs
1. **Logging Inventory**
   - Use `rg "console\.(log|warn)" backend/src/{middleware,services,controllers}` and `rg "console\.(log|warn)" mobile/src` to list current auth/upload logs.
   - Flag any log statements that include user IDs, session IDs, JWT payloads, OCR text, inviter emails, etc.
2. **Policy Definition**
   - Adopt rule: production logs must not include raw tokens, decoded claims, email addresses, OCR text, or other PII. Debug logging can remain behind an explicit `DEBUG_*` env check if needed.
3. **Implementation**
   - Remove or sanitize:
     - `[ClerkSync] Decoded token payload` and other verbose auth logs in `clerkAuthGateway.ts`.
     - Auth success logs in `attachBearerUser.ts` and `services/realtime.ts` that emit user identifiers; replace with metric increments only.
     - OCR preview/snippet logs in `controllers/api/upload.ts`.
   - Ensure any retained warnings/errors describe the issue without embedding secrets (e.g., “Clerk JWKS verification failed”).
4. **Regression Coverage**
   - Adjust unit tests that asserted on specific log output (if any) to focus on functional behavior instead.
   - Add a lint-style check (optional) or CI note to prevent reintroducing sensitive logs.
5. **Verification Sweep**
   - Run `npm run test:backend` to confirm no test regressions.
   - Smoke-test an upload flow locally, confirming behavior but inspecting terminal output to ensure sensitive data is absent.
6. **Documentation**
   - Update developer guidelines (e.g., `docs/security.md` or `docs/observability.md`) with the new logging expectations.
   - Notify the team that detailed debug logging was removed and may need targeted reintroduction under explicit debug flags if future troubleshooting requires it.

**Risks & Mitigations**
- *Risk*: Reduced logging obscures future debugging. **Mitigation**: Document how to enable verbose logging safely (e.g., via local-only env flags) if needed.
- *Risk*: Residual log statements remain elsewhere. **Mitigation**: Include the grep commands in PR checklist and consider automated scanning in CI.

---

## Validation Checklist (both workstreams)
- [ ] `npm run test:backend`
- [ ] `npm run test:contracts`
- [ ] Manual auth/token smoke test (good vs. tampered token)
- [ ] Manual bill photo upload check (confirm no OCR text or session data logged)
- [ ] Documentation updated and communicated to stakeholders
