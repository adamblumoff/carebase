# Realtime Event Contract

Carebase uses Socket.IO to push plan updates to connected clients. Each authenticated user room receives `plan:item-delta` events that describe the relevant mutations so clients can patch their local cache without fetching the entire plan.

## Socket Payload

```ts
interface PlanItemDelta {
  itemType: 'appointment' | 'bill' | 'plan';
  entityId: number;
  planItemId?: number;
  action: 'created' | 'updated' | 'deleted';
  version?: number;
  source?: 'rest' | 'collaborator' | 'google' | 'inbound';
  data?: {
    appointment?: AppointmentPayload;
    bill?: BillPayload;
    section?: 'collaborators' | 'pending-reviews' | string;
  };
}

interface PlanItemDeltaPayload {
  deltas: PlanItemDelta[];
}
```

- `itemType`: the resource that changed. When we cannot provide a granular delta (e.g. batch operations), a synthetic `plan` delta is emitted so clients know to refresh.
- `entityId`: the appointment/bill primary key (or `0` for `plan` deltas).
- `planItemId`: optional `items.id` for cross-referencing legacy structures.
- `action`: CRUD indicator. Always `updated` for `plan` deltas.
- `version`: latest `users.plan_version` at emit time (use to order deltas).
- `source`: hints at the origin (`rest`, `collaborator`, `google`, `inbound`).
- `data`: normalized payload when available (`toAppointmentPayload`/`toBillPayload`). When `itemType` is `plan`, `data.section` may indicate which feature (e.g. `collaborators`) should refresh.

Clients should attempt to apply deltas optimistically, but fall back to a silent refresh (`/api/plan`) when:

- The delta references an unknown entity (e.g. `bill` not in cache but action is `updated`).
- `itemType` is `plan`.
- Required payload (`data`) is missing for a `created`/`updated` action.

## Emission Rules

- All CRUD mutations inside `appointments`/`bills` queries emit deltas alongside the plan version bump.
- Google sync pull updates tag deltas with `source: 'google'`.
- Inbound email classification uses `source: 'inbound'`.
- When we cannot compute precise changes (legacy migrations, bulk jobs), the fallback `plan` delta is sent.

## Client Expectations

1. Subscribe to `plan:item-delta`.
2. Apply incoming deltas in order, updating local `planVersion` with the highest `version` observed.
3. When local patching fails or a `plan` delta arrives, trigger a silent refresh.
4. Maintain existing polling (`/api/plan/version`) as a safety net for disconnected sockets (especially if sockets drop or older builds are still in the wild).

## Future Work

- Track metrics for delta volume (`plan.delta.*`) to ensure emit rates stay healthy.
