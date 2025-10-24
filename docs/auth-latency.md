# Auth Latency Baseline (Phase 1)

Collected on **October 24, 2025** using `scripts/dev/measure-auth-latency.ts` against the development backend running locally.

Client session token sourced from Clerk dev instance (`feasible-kiwi-29`), device: Expo iOS simulator.

## Flow Timing (milliseconds)

| Flow | Step | Run 1 | Run 2 | Run 3 | Avg |
| --- | --- | --- | --- | --- | --- |
| login-bootstrap | `/api/auth/session` | 3864.6 | 3233.2 | 3611.3 | 3569.7 |
|  | `/api/plan` | 3359.1 | 3335.9 | 3719.8 | 3471.6 |
|  | `/api/plan/version` | 4032.1 | 3664.4 | 3592.3 | 3762.9 |
|  | `/api/collaborators` | 3523.7 | 3371.6 | 3859.2 | 3584.8 |
|  | `/api/review/pending` | 3529.8 | 3617.5 | 3978.8 | 3708.7 |
|  | `/api/integrations/google/status` | 3547.4 | 3359.0 | 3225.3 | 3377.2 |
| plan-refresh | `/api/plan` | 3236.4 | 3123.3 | 3161.1 | 3173.6 |
|  | `/api/plan/version` | 3740.4 | 3760.7 | 3182.5 | 3561.2 |

## Observations

- All endpoints consistently take **3.2–4.0 seconds** despite being simple reads, confirming that request time is dominated by Clerk verification overhead.
- Backend console logs during capture showed repeated `Clerk middleware auth state … isAuthenticated: false` followed by `Clerk token verification via JWKS`, reinforcing that every request re-validates with Clerk instead of honoring middleware state.
- No metric flush lines were emitted during the capture window; counters will be re-checked after Phase 2 once fast-path auth is restored.

These numbers serve as the regression baseline for subsequent phases. Once optimizations land, rerun the script and update this file with the new timings.
