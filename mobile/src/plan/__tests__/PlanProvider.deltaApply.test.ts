import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PlanItemDelta, PlanPayload } from '@carebase/shared';

let upsertPlanWithDelta: (plan: PlanPayload | null, delta: PlanItemDelta) => PlanPayload | null;

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ status: 'signedIn' })
}));

vi.mock('../../utils/realtime', () => ({
  ensureRealtimeConnected: vi.fn(),
  isRealtimeConnected: () => true,
  addPlanDeltaListener: () => () => {},
  addRealtimeStatusListener: () => () => {}
}));

vi.mock('../../utils/planEvents', () => ({
  addPlanChangeListener: () => () => {},
  emitPlanChanged: () => {}
}));

vi.mock('../../api/plan', () => ({
  fetchPlan: vi.fn(),
  fetchPlanVersion: vi.fn()
}));

beforeAll(async () => {
  (globalThis as any).__DEV__ = false;
  const mod = await import('../PlanProvider');
  upsertPlanWithDelta = mod.__testUpsertPlanWithDelta;
});

// rest same as before
const basePlan: PlanPayload = {
  recipient: { id: 1, displayName: 'Alex' },
  dateRange: {
    start: '2025-10-01T00:00:00.000Z',
    end: '2025-10-31T23:59:59.000Z'
  },
  appointments: [],
  bills: [],
  planVersion: 3,
  planUpdatedAt: null,
  collaborators: []
};

describe('upsertPlanWithDelta', () => {
  it('returns null when plan state absent', () => {
    const delta: PlanItemDelta = {
      itemType: 'bill',
      entityId: 1,
      action: 'created',
      data: {
        bill: {
          id: 1,
          itemId: 10,
          createdAt: '2025-10-01T00:00:00.000Z',
          statementDate: null,
          amount: null,
          dueDate: null,
          payUrl: null,
          status: 'todo',
          taskKey: 'task',
          assignedCollaboratorId: null,
          googleSync: null
        }
      }
    };

    expect(upsertPlanWithDelta(null, delta)).toBeNull();
  });

  it('adds new bill on created delta', () => {
    const delta: PlanItemDelta = {
      itemType: 'bill',
      entityId: 1,
      planItemId: 10,
      action: 'created',
      version: 4,
      data: {
        bill: {
          id: 1,
          itemId: 10,
          createdAt: '2025-10-01T00:00:00.000Z',
          statementDate: null,
          amount: 25,
          dueDate: null,
          payUrl: null,
          status: 'todo',
          taskKey: 'task',
          assignedCollaboratorId: null,
          googleSync: null
        }
      }
    };

    const next = upsertPlanWithDelta(basePlan, delta);
    expect(next?.bills.length).toBe(1);
    expect(next?.bills[0]?.id).toBe(1);
    expect(next?.planVersion).toBe(4);
  });

  it('updates existing appointment', () => {
    const startPlan: PlanPayload = {
      ...basePlan,
      appointments: [
        {
          id: 2,
          itemId: 20,
          createdAt: '2025-10-01T00:00:00.000Z',
          startLocal: '2025-10-05T10:00:00.000-05:00',
          endLocal: '2025-10-05T11:00:00.000-05:00',
          startTimeZone: 'America/Chicago',
          endTimeZone: 'America/Chicago',
          startOffset: '-05:00',
          endOffset: '-05:00',
          location: 'Clinic',
          prepNote: 'Bring form',
          summary: 'Initial visit',
          icsToken: 'token',
          assignedCollaboratorId: null,
          googleSync: null
        }
      ]
    };

    const delta: PlanItemDelta = {
      itemType: 'appointment',
      entityId: 2,
      planItemId: 20,
      action: 'updated',
      version: 5,
      data: {
        appointment: {
          id: 2,
          itemId: 20,
          createdAt: '2025-10-01T00:00:00.000Z',
          startLocal: '2025-10-05T12:00:00.000-05:00',
          endLocal: '2025-10-05T13:00:00.000-05:00',
          startTimeZone: 'America/Chicago',
          endTimeZone: 'America/Chicago',
          startOffset: '-05:00',
          endOffset: '-05:00',
          location: 'Clinic',
          prepNote: 'Bring form',
          summary: 'Initial visit (updated)',
          icsToken: 'token',
          assignedCollaboratorId: null,
          googleSync: null
        }
      }
    };

    const next = upsertPlanWithDelta(startPlan, delta);
    expect(next?.appointments[0]?.summary).toContain('updated');
    expect(next?.planVersion).toBe(5);
  });

  it('removes appointment on deleted delta', () => {
    const startPlan: PlanPayload = {
      ...basePlan,
      appointments: [
        {
          id: 3,
          itemId: 30,
          createdAt: '2025-10-01T00:00:00.000Z',
          startLocal: '2025-10-05T10:00:00.000-05:00',
          endLocal: '2025-10-05T11:00:00.000-05:00',
          startTimeZone: 'America/Chicago',
          endTimeZone: 'America/Chicago',
          startOffset: '-05:00',
          endOffset: '-05:00',
          location: 'Clinic',
          prepNote: 'Bring form',
          summary: 'Initial visit',
          icsToken: 'token',
          assignedCollaboratorId: null,
          googleSync: null
        }
      ]
    };

    const delta: PlanItemDelta = {
      itemType: 'appointment',
      entityId: 3,
      planItemId: 30,
      action: 'deleted'
    };

    const next = upsertPlanWithDelta(startPlan, delta);
    expect(next?.appointments.length).toBe(0);
  });

  it('returns original plan when delta lacks payload for create/update', () => {
    const delta: PlanItemDelta = {
      itemType: 'bill',
      entityId: 5,
      action: 'created'
    };

    const result = upsertPlanWithDelta(basePlan, delta);
    expect(result).toBe(basePlan);
  });
});
