import { describe, expect, it } from 'vitest';
import type { PlanPayload } from '@carebase/shared';
import { decideRefreshToast, findCollaboratorEmail, summarizePlan } from './presenter';

describe('plan presenter', () => {
  const plan: PlanPayload = {
    planVersion: 1,
    planUpdatedAt: '2025-01-01T00:00:00Z',
    dateRange: { start: 'Jan 1', end: 'Jan 7' } as any,
    appointments: [
      { id: 1, summary: 'Appt', startLocal: '2025-01-02T10:00:00Z', endLocal: '2025-01-02T11:00:00Z' } as any,
    ],
    bills: [
      { id: 1, status: 'pending' } as any,
      { id: 2, status: 'paid' } as any,
    ],
    collaborators: [
      { id: 5, email: 'nurse@test.com' } as any,
    ],
    recipient: { id: 1, displayName: 'Recipient' } as any,
  };

  it('summarizes plan counts', () => {
    const summary = summarizePlan(plan);
    expect(summary).toEqual({
      appointmentCount: 1,
      billsDueCount: 1,
      totalBills: 2,
      dateRange: plan.dateRange,
    });

    expect(summarizePlan(null)).toEqual({
      appointmentCount: 0,
      billsDueCount: 0,
      totalBills: 0,
      dateRange: null,
    });
  });

  it('finds collaborator email by id', () => {
    expect(findCollaboratorEmail(plan, 5)).toBe('nurse@test.com');
    expect(findCollaboratorEmail(plan, 99)).toBeNull();
    expect(findCollaboratorEmail(null, 5)).toBeNull();
  });

  it('decides toast messages for updates', () => {
    const manualSuccess = decideRefreshToast({ source: 'manual', success: true, timestamp: 1 }, true, 0);
    expect(manualSuccess).toEqual({ message: 'Plan updated', timestamp: 1 });

    const manualFailWithPlan = decideRefreshToast({ source: 'manual', success: false, timestamp: 2 }, true, 0);
    expect(manualFailWithPlan).toEqual({
      message: 'Unable to refresh plan. Showing saved data',
      timestamp: 2,
    });

    const manualFailNoPlan = decideRefreshToast({ source: 'manual', success: false, timestamp: 3 }, false, 0);
    expect(manualFailNoPlan).toEqual({ message: 'Unable to refresh plan', timestamp: 3 });

    const realtime = decideRefreshToast({ source: 'realtime', success: true, timestamp: 4 }, true, 0);
    expect(realtime).toEqual({ message: 'Plan refreshed', timestamp: 4 });

    const repeated = decideRefreshToast({ source: 'manual', success: true, timestamp: 4 }, true, 4);
    expect(repeated).toEqual({ message: null, timestamp: null });

    const nullCase = decideRefreshToast(null, true, 0);
    expect(nullCase).toEqual({ message: null, timestamp: null });
  });
});
