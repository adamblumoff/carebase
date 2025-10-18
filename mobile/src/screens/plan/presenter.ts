import type { PlanPayload } from '@carebase/shared';
import type { PlanUpdateMeta } from '../../plan/PlanProvider';

export interface PlanSummary {
  appointmentCount: number;
  billsDueCount: number;
  totalBills: number;
  dateRange: PlanPayload['dateRange'] | null;
}

export function summarizePlan(plan: PlanPayload | null): PlanSummary {
  const appointmentCount = plan?.appointments.length ?? 0;
  const totalBills = plan?.bills.length ?? 0;
  const billsDueCount = plan?.bills.filter((bill) => bill.status !== 'paid').length ?? 0;

  return {
    appointmentCount,
    billsDueCount,
    totalBills,
    dateRange: plan?.dateRange ?? null,
  };
}

export function findCollaboratorEmail(
  plan: PlanPayload | null,
  collaboratorId: number | null | undefined
): string | null {
  if (!plan || !collaboratorId) {
    return null;
  }

  const match = plan.collaborators?.find((collaborator) => collaborator.id === collaboratorId);
  return match?.email ?? null;
}

export type ToastDecision = {
  message: string | null;
  timestamp: number | null;
};

export function decideRefreshToast(
  lastUpdate: PlanUpdateMeta | null,
  hasPlan: boolean,
  previousTimestamp: number
): ToastDecision {
  if (!lastUpdate) {
    return { message: null, timestamp: null };
  }

  if (lastUpdate.timestamp === previousTimestamp) {
    return { message: null, timestamp: null };
  }

  if (lastUpdate.source === 'manual') {
    if (lastUpdate.success) {
      return { message: 'Plan updated', timestamp: lastUpdate.timestamp };
    }

    return {
      message: hasPlan ? 'Unable to refresh plan. Showing saved data' : 'Unable to refresh plan',
      timestamp: lastUpdate.timestamp,
    };
  }

  if (lastUpdate.source === 'realtime' && lastUpdate.success) {
    return { message: 'Plan refreshed', timestamp: lastUpdate.timestamp };
  }

  return { message: null, timestamp: null };
}
