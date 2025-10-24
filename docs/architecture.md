# Backend Architecture Notes

Updated October 24, 2025 to reflect the Clerk auth gateway and realtime emitter refactor.

## Layering Overview

```
server.ts → routes → controllers → services → db queries → db client
```

- **Auth gateway** (`backend/src/services/clerkAuthGateway.ts`) owns Clerk client/bootstrap + session verification. Both `clerkSyncService` and `realtime` consume it so neither service depends on the other.
- **Realtime emitter** (`backend/src/realtime/emitter.ts`) is a slim singleton that stores the active Socket.IO publisher instance. The database layer imports only this module; it no longer depends on full `services/realtime`.
- **Services** orchestrate domain workflows (Google sync, Clerk sync, email parsing) and call into `db/` for persistence.
- **Database layer** exposes query helpers exclusively. Realtime emission and Google sync scheduling are accessed via injected helpers (`getRealtimeEmitter`, dynamic scheduler setter).

## Dependency Guardrail

Dependency-cruiser enforces the boundary between `backend/src/db/**` and most of `backend/src/services/**`:

- Run `npm run lint:deps` to verify no new direct imports were introduced.
- The rule currently allows calls into `services/googleSync.ts` until scheduling logic moves fully into the service layer.

## Realtime Flow

1. `services/realtime.ts` bootstraps Socket.IO and registers the emitter through `setRealtimeEmitter`.
2. Queries that update plan data call `getRealtimeEmitter()` from `backend/src/realtime/emitter.ts` to push deltas after they commit.
3. Tests inject fakes via `__setRealtimeEmitterForTests`.

## Clerk Integration

- `clerkAuthGateway` provides `getClerkClient()` and `verifyClerkSessionToken()`.
- `clerkSyncService` focuses on synchronization, metadata shaping, and backfill logic.
- Realtime socket auth uses the gateway to verify tokens without re-importing sync service internals.
- Run `npm run configure:clerk-template` after updating Clerk keys to ensure the session-based JWT
  template (`carebase-backend`) exists with a 30 minute lifetime. Both backend and mobile default to
  this template via `CLERK_JWT_TEMPLATE_NAME` / `EXPO_PUBLIC_CLERK_JWT_TEMPLATE`.

Keep this document up to date when adjusting boundaries or adding new cross-cutting helpers.
