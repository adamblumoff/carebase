# Carebase Mobile App Deep Dive

This document explains how the Expo/React Native app inside `mobile/` is wired, from bootstrap through the major screens, theming, networking, realtime updates, and auth. Use it as a guide when extending the client or debugging flows.

---

## 1. Runtime & Project Layout

### Entry Points
- **`mobile/index.ts`**: Expo entry file; calls `registerRootComponent(App)`.
- **`mobile/App.tsx`**: Wraps navigation in the shared `ThemeProvider` and sets the `StatusBar` style according to the current color scheme.

### Key Subdirectories
- `src/api` – Axios client (`apiClient`) plus interceptors for auth tokens.
- `src/config.ts` – Centralizes environment-aware constants (API base URL, Google OAuth IDs, REST endpoints).
- `src/navigation` – Stack navigator with screen registrations.
- `src/screens` – Views for login, plan overview, detail pages, camera upload, and settings.
- `src/theme.tsx` – Theming context, palettes, spacing, radius, and shadow utilities.
- `src/utils` – Helpers for plan-change events and Socket.IO realtime connectivity.
- `src/components` – Reusable UI bits (`KeyboardScreen` wrapper for forms).

Expo configuration (`mobile/app.json`) is set to `"userInterfaceStyle": "automatic"`, so the app respects the device’s light/dark preference. Remember to restart Expo with `npx expo start -c` after changing this file.

---

## 2. Theming System

### ThemeProvider & Hook
- `ThemeProvider` uses `useColorScheme()` and React context to expose:
  - `palette`: light/dark color tokens (background/canvas/surface, typography colors, semantic accents).
  - `shadow`: dynamic card elevation tuned per mode.
  - `spacing(factor)` and `radius` constants.
  - `colorScheme`: the resolved `'light' | 'dark'`.
- `useTheme()` is the source of truth; components should call it instead of importing palette objects directly.

### Palettes
- **Light**: Greens on ivory (`background: #e8f3eb`, `canvas: #ffffff`). Higher contrast than the original palette so cards pop.
- **Dark**: Deep green-blacks (`background: #05130a`, `surface: #12331f`) with mint typography for readability.

### Implementation Pattern
Every screen memoizes styles:
```ts
const { palette, shadow } = useTheme();
const styles = useMemo(() => createStyles(palette, shadow), [palette, shadow]);
```
This ensures React Native rebuilds styles when the device appearance changes.

> **Callout:** Two screens (`BillDetailScreen`, `AppointmentDetailScreen`) still spread `shadow.card` inline instead of in their StyleSheet. It’s fine today but could be moved into `createStyles` for consistency.

---

## 3. Navigation Layer

- `AppNavigator` (Native Stack) defines routes: `Login`, `Plan`, `AppointmentDetail`, `BillDetail`, `Settings`, `Camera`.
- The navigator consumes the theme to tint headers and background. We extend `DefaultTheme`/`DarkTheme` from React Navigation to keep typography defaults (`fonts.regular` etc.) intact.
- `initialRouteName` is `Login`. After auth the app calls `navigation.replace('Plan')` to drop the login screen from history.

---

## 4. Configuration & Networking

### Environment Setup
- `API_BASE_URL` resolves to `EXPO_PUBLIC_API_BASE_URL` if provided; otherwise defaults to `http://localhost:3000` in development and a placeholder production URL.
- Google OAuth IDs (`GOOGLE_CLIENT_ID`) are also read from Expo env vars. Provide platform-specific values via `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, and `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID` so both login and Calendar sync can complete successfully. The defaults in `config.ts` are placeholders—replace them before any external testing.

### Axios Client (`src/api/client.ts`)
- Configured with the base URL, JSON headers, 10s timeout.
- **Request interceptor** injects the stored `accessToken` from `AsyncStorage`.
- **Response interceptor** logs responses, strips the token on `401`, and propagates errors.

### REST Endpoints
`API_ENDPOINTS` in `config.ts` enumerates the REST paths for plan, appointments, bills, and uploads. Screens import functions like `API_ENDPOINTS.updateAppointment(id)` to keep URL strings centralized.

---

## 5. Auth & Session Flow

### Login Screen
- Launches Google OAuth with Expo’s `WebBrowser.openAuthSessionAsync`.
- Exchanges the returned `loginToken` for a backend-issued `accessToken` (`POST /api/auth/mobile-login`).
- Stores the token in `AsyncStorage` and clears legacy cookie remnants (`sessionCookie`).
- Verifies the session via `GET /api/auth/session`; on success navigates to `Plan`.
- Dev shortcut (`__DEV__`) lets engineers skip auth by clearing tokens and jumping to `Plan`.

### Token Lifecycle
- Stored token is added to every request via the interceptor.
- On unauthorized responses the token gets removed, forcing re-login.
- Realtime socket auth also fetches the token from storage.

---

## 6. Weekly Plan & Realtime Updates

### Plan Screen (`PlanScreen.tsx`)
- Bootstraps from the last cached payload in AsyncStorage (`plan_cache_v1`) so the screen can render instantly offline.
- Fetches fresh data with up to three retries (exponential backoff) and stores success responses back into the cache.
- Displays appointments and bills with sections, empty states, and status pills.
- Shows collaborator assignment badges when `assignedCollaboratorId` is present, resolving emails from the plan payload’s `collaborators` array.
- Pull-to-refresh triggers a silent retry that surfaces a toast on success/failure.
- **Realtime Integration**:
  - `ensureRealtimeConnected()` from `utils/realtime` creates a Socket.IO client pointed at `API_BASE_URL`.
  - Server-sent `plan:update` events dispatch `emitPlanChanged()`, which notifies all listeners registered via `addPlanChangeListener`.
  - Plan screen subscribes to these events to refresh data quietly.
- **Polling Fallback**: When realtime is disconnected, the screen polls `/api/plan/version` every 15s; if the version increases it refetches the plan.

### Data Helpers
- Parsing utilities convert ISO date strings from the API into JS `Date` objects for formatting with `toLocaleDateString`/`toLocaleTimeString`.
- Amounts are formatted with `Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })`.

---

## 7. Detail Screens

### Appointment Detail
- Uses `KeyboardScreen` to handle form scrolling with keyboard avoidance.
- Maintains editable state for summary, location, start time/date via `useState`.
- `handleSave` patches the API, updates local state with the response, and triggers a plan refresh via `emitPlanChanged()`.
- Date/time picking runs through the shared `DateTimePickerModal` component (iOS modal + Android native picker).
- `handleDelete` issues a `DELETE` and navigates back on success.
- Owners get an “Assign collaborator” shortcut to hand the visit to a teammate; the modal sources names from `/api/collaborators`.
- Contributors see a “Mark visit handled” button that stamps a prep note and returns to the plan.

### Bill Detail
- Presents summary cards showing amount, status, and dates.
- `Mark as paid` calls `/api/bills/:id/mark-paid`; `Delete` removes the bill.
- If the bill has a payment URL, the primary CTA opens it via `Linking.openURL`.
- Similar to appointments, API responses drive local state updates.
- Owners can reassign the bill via the inline modal; contributors can still trigger “Mark as paid” without touching other fields.

---

## 8. Uploading Bills (Camera Screen)

- Requests camera permission through `expo-image-picker` (`requestCameraPermissionsAsync`).
- Supports both direct capture (`launchCameraAsync`) and library selection (`launchImageLibraryAsync`) with light editing.
- Builds a `FormData` payload and posts to `/api/upload/photo`.
- Handles the API response (classification, extracted amount/due date, overdue status) and surfaces the info in an alert. On success it triggers a plan change and returns to the previous screen.
- Uses the themed buttons and cards for previewing the captured image.

---

## 9. Settings & Misc Components

### Settings Screen
- Static account information plus app preference placeholders.
- Care team section fetches `/api/collaborators`, lists accepted/pending teammates, and lets owners send invite emails inline.
- Uses the same card background (`palette.canvas`) for all tiles (see recent fix aligning colors).
- Logout button simply replaces the stack with `Login`—backend invalidation still TODO.
- The API base URL read from `config.ts` helps confirm environment wiring at runtime.
- Calendar sync card consumes `useGoogleCalendarIntegration` to drive Google OAuth (PKCE), expose connect/disconnect/manual sync actions, and surface backend status fields (last sync timestamp, pending count, error message).
- Calendar sync card now mirrors the login flow: the hook asks the backend for a consent URL, launches `WebBrowser.openAuthSessionAsync` against the ngrok-hosted API, and listens for the `carebase://integrations/google` deep link to determine success or failure.

### KeyboardScreen Component
- Wraps children in `SafeAreaView`, `KeyboardAvoidingView`, and `ScrollView`.
- `keyboardVerticalOffset` defaults to `24` on iOS to keep fields visible above the keyboard.
- Accepts optional container and content styles so screens can merge theme-aware styles.

---

## 10. Realtime Helper (`utils/realtime.ts`)

- Lazily creates a single Socket.IO connection.
- Tracks connection state (`connecting`, `connected`), exposes `ensureRealtimeConnected()` and `isRealtimeConnected()`.
- Subscribes to `plan:update` and forwards to `emitPlanChanged()`.
- Uses the ESM build of `socket.io-client`. Works in Expo 54; if bundler warnings appear, consider switching to the default import (`socket.io-client`) and enabling `expo-yarn-workspaces` externals.

---

## 11. Shared Types

`@carebase/shared` exports TypeScript interfaces for `Appointment`, `Bill`, etc., which the mobile app imports via workspace alias (`import type { Appointment } from '@carebase/shared'`). Keep backend and mobile in sync by updating shared types first.

---

## 12. Developer Workflow Notes

- **Running Locally**: From repo root, `npm install`, then `npm run dev:mobile`. Provide `EXPO_PUBLIC_API_BASE_URL` so the app can reach the backend (use ngrok when running on a device).
- **Testing**: `npm test --workspace=mobile` runs `jest-expo` with mocks for `expo-auth-session`, AsyncStorage, and theming. Pair it with `npm test --workspace=@carebase/backend` whenever you touch shared integration flows.
- **Tokens**: Debug stored tokens with `AsyncStorage.getItem('accessToken')` via React Native DevTools or by instrumenting the interceptors.
- **Caching**: After editing `app.json` or adding native modules ensure you stop Expo and run `npx expo start -c`.
- **API Docs**: Run `npm run docs:routes --workspace=backend` whenever routes change to refresh `docs/api-routes.md`.

---

## 13. Observations & Follow-ups

1. **OAuth Client IDs**: `config.ts` still points to placeholder Google client IDs. Replace them with real values before shipping login outside a dev environment.
2. **Logout Flow**: Settings screen only pops to `Login`; it does not call `/api/auth/logout`. If server-side session revocation matters, add the request.
3. **Realtime Client Import**: Using `socket.io-client/dist/socket.io.esm.min.js` is a bit brittle; the main package (`import { io } from 'socket.io-client'`) is preferable if bundler size permits.
4. **Error Handling**: Most screens alert on generic errors. Consider centralizing messaging or adding retry states for better UX.
5. **Testing Gap**: No automated tests in the mobile workspace. Establishing a Jest config would help protect login and plan flows as the app grows.

---

This walkthrough should give you a working mental model of the mobile client. Use it alongside the source to dive deeper into specific modules. Let me know if you want similar deep dives for the backend or shared packages.***
