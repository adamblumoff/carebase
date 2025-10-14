# Carebase Mobile API Flow Guide

This reference describes how the React Native client routes requests to the backend, what each endpoint expects, and how responses move through the app. Use it to understand data flow or when adding new API calls.

---

## 1. Client Plumbing

### Base URL & Endpoints
- `API_BASE_URL` comes from `EXPO_PUBLIC_API_BASE_URL` (falling back to `http://localhost:3000` in dev). Change it in `mobile/src/config.ts`.
- `API_ENDPOINTS` centralizes path strings for all REST routes (auth, plan, appointments, bills, uploads).

### Axios Client
- Defined in `mobile/src/api/client.ts`.
- Request interceptor pulls the `accessToken` from `AsyncStorage` and sets `Authorization: Bearer <token>`.
- Response interceptor logs success, clears the token on `401`, and propagates the error for UI handling.

### State Updates
- Screens call `apiClient` and reconcile responses into component state.
- Mutations emit `emitPlanChanged()` which notifies listeners (Plan screen, realtime listeners) to refresh data.

---

## 2. Authentication Endpoints

| Endpoint | Method | Triggered From | Payload | Response | Follow-up |
|----------|--------|----------------|---------|----------|-----------|
| `/api/auth/mobile-login` | `POST` | `LoginScreen.authenticate()` | `{ authToken: loginToken }` where `loginToken` comes from Google OAuth redirect | `{ accessToken }` | Store token in `AsyncStorage`, clear cookies, call `checkSession`. |
| `/api/auth/session` | `GET` | After login exchange; also used implicitly by backend via cookie | none | `{ authenticated: boolean }` | If authenticated, navigate to `Plan`. If not, prompt error. |
| `/api/auth/logout` | *(not currently called)* | — | — | — | Consider integrating for future logout improvements. |

**Data Flow:**  
User taps “Continue with Google” → Expo opens OAuth session → backend issues `loginToken` → client posts to `/api/auth/mobile-login` → stores `accessToken` → verifier call to `/api/auth/session` → navigation replaces `Login` with `Plan`.  
Any `401` on subsequent requests clears `accessToken` to force re-authentication.

---

## 3. Plan Retrieval & Realtime Sync

| Endpoint | Method | Triggered From | Payload | Response | Follow-up |
|----------|--------|----------------|---------|----------|-----------|
| `/api/plan` | `GET` | `PlanScreen.fetchPlan()` on mount, refresh, realtime events, and polling | none | `{ appointments: Appointment[], bills: Bill[], dateRange, planVersion, ... }` | Updates component state (`planData`, `loading`, `refreshing`). |
| `/api/plan/version` | `GET` | Polling inside `useFocusEffect` every 15s when realtime disconnected | none | `{ planVersion: number }` | If version > cached value, trigger silent `fetchPlan`. |

**Realtime Flow:**  
`ensureRealtimeConnected()` creates a Socket.IO client pointing to `API_BASE_URL`. When the backend emits `plan:update`, `emitPlanChanged()` fires, causing `PlanScreen` to refetch (silent). This keeps the UI synced without manual refresh.

---

## 4. Appointment Endpoints

| Endpoint | Method | Triggered From | Payload | Response | Follow-up |
|----------|--------|----------------|---------|----------|-----------|
| `/api/appointments/:id` | `PATCH` | `AppointmentDetailScreen.handleSave()` | `{ startLocal, endLocal, summary, location?, prepNote? }` formatted via `formatForPayload` | Updated `Appointment` | Update local state, sync plan, close editing mode, show success alert. |
| `/api/appointments/:id` | `DELETE` | `AppointmentDetailScreen.handleDelete()` | none | Confirmation (empty body or updated plan) | Emit plan change and navigate back. |
| `/api/appointments/:id` | `GET` | *(not currently called on mobile)* | — | — | Endpoint is defined for parity if future detail pages need fresh fetches. |

**Data Flow Example:**  
User edits time → `pendingStart`/`pendingSummary` updated locally → tap “Save” → request carries ISO strings → response replaces `currentAppointment` state → plan change emitted so overview refreshes.

---

## 5. Bill Endpoints

| Endpoint | Method | Triggered From | Payload | Response | Follow-up |
|----------|--------|----------------|---------|----------|-----------|
| `/api/bills/:id/mark-paid` | `POST` | `BillDetailScreen.handleMarkPaid()` | none | Updated `Bill` | Update local card, emit plan change, show success alert. |
| `/api/bills/:id` | `DELETE` | `BillDetailScreen.handleDelete()` | none | Success/no content | Emit plan change, navigate back. |
| `/api/bills/:id` | `PATCH` | *(not wired yet)* | — | — | Placeholder for future bill edits. |
| `/api/bills/:id` | `GET` | *(not called)* | — | — | Available if detail fetch becomes necessary. |

**Data Flow Example:**  
Tap “Mark as paid” → POST marks status server-side → response returned → state updated (causing status pill + accent color change) → `emitPlanChanged()` ensures plan list reflects new bill state.

---

## 6. Upload Endpoint

| Endpoint | Method | Triggered From | Payload | Response | Follow-up |
|----------|--------|----------------|---------|----------|-----------|
| `/api/upload/photo` | `POST` | `CameraScreen.handleUpload()` | `FormData` with `{ photo: { uri, name, type } }` | `{ classification, extracted, overdue }` | Display alert summarizing extraction, emit plan change, navigate back. |

**Data Flow:**  
Camera/library returns `imageUri` → `FormData` appended → axios POST with `multipart/form-data` header → backend returns classification details → UI surfaces details and triggers plan refresh.

---

## 7. Supporting Utilities & Flow Control

- **`planEvents.ts`**: Simple event emitter; registers callbacks that fire on data-changing actions (appointment save/delete, bill updates, successful upload).
- **`realtime.ts`**: Wraps Socket.IO client. Integrates with AsyncStorage to send the bearer token in `auth`. Emits plan changes for UI refresh.
- **`PlanScreen` Polling**: If realtime socket is connected, polling sleeps; if disconnected, it periodically checks `/api/plan/version`.

---

## 8. Known Gaps & Notes

1. **Logout Endpoint**: Settings screen doesn’t call `/api/auth/logout`, so server sessions persist until expiry. Add a call if backend needs explicit revocation.
2. **Unused GET Endpoints**: Mobile doesn’t yet call `/api/appointments/:id` or `/api/bills/:id` directly but endpoint builders exist for future enhancements.
3. **Error Surfacing**: Most mutations surface generic alerts. Consider standardizing error messages per endpoint for better UX.
4. **Token Expiry Handling**: On `401` the client removes the token but doesn’t automatically redirect to login. Screens should check for missing token and navigate accordingly if this becomes a common state.

---

Use this guide alongside the TypeScript source to trace data end-to-end. When adding new endpoints, define them in `API_ENDPOINTS`, use the shared `apiClient`, and emit plan change events if they impact aggregated data.***
