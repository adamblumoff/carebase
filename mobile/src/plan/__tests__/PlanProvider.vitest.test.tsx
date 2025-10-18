import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlanPayload } from '@carebase/shared';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { PlanProvider, usePlan } from '../PlanProvider';

type Listener = () => void;

const fetchPlanMock = vi.fn<[], Promise<PlanPayload>>();
const fetchPlanVersionMock = vi.fn<[], Promise<number>>();
const addPlanChangeListenerMock = vi.fn<(listener: Listener) => () => void>();
const ensureRealtimeConnectedMock = vi.fn<[], Promise<void>>();
const isRealtimeConnectedMock = vi.fn<[], boolean>();

vi.mock('../../api/plan', () => ({
  fetchPlan: () => fetchPlanMock(),
  fetchPlanVersion: () => fetchPlanVersionMock(),
}));

vi.mock('../../utils/planEvents', () => ({
  addPlanChangeListener: (listener: Listener) => addPlanChangeListenerMock(listener),
}));

vi.mock('../../utils/realtime', () => ({
  ensureRealtimeConnected: () => ensureRealtimeConnectedMock(),
  isRealtimeConnected: () => isRealtimeConnectedMock(),
}));

function createPlan(overrides: Partial<PlanPayload> = {}): PlanPayload {
  return {
    recipient: {
      id: 1,
      displayName: 'Owner',
    },
    dateRange: {
      start: new Date().toISOString(),
      end: new Date().toISOString(),
    },
    planVersion: 1,
    planUpdatedAt: new Date().toISOString(),
    collaborators: [],
    appointments: [],
    bills: [],
    ...overrides,
  };
}

function renderProvider() {
  const latestValue: { current: ReturnType<typeof usePlan> | null } = { current: null };

  function Capture() {
    const value = usePlan();
    latestValue.current = value;
    return null;
  }

  render(
    <PlanProvider>
      <Capture />
    </PlanProvider>
  );

  return latestValue;
}

describe('PlanProvider', () => {
  const listeners: Listener[] = [];

  beforeEach(async () => {
    fetchPlanMock.mockReset();
    fetchPlanVersionMock.mockReset();
    ensureRealtimeConnectedMock.mockReset();
    isRealtimeConnectedMock.mockReset();
    addPlanChangeListenerMock.mockReset();
    listeners.length = 0;

    addPlanChangeListenerMock.mockImplementation((listener: Listener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    });

    ensureRealtimeConnectedMock.mockResolvedValue();
    isRealtimeConnectedMock.mockReturnValue(false);

    await AsyncStorage.clear();
  });

  it('refreshes the plan manually and normalizes payload data', async () => {
    const plan = createPlan({
      planVersion: 5,
      collaborators: null as unknown as PlanPayload['collaborators'],
      appointments: undefined,
      bills: undefined,
    });

    fetchPlanMock.mockResolvedValue(plan);

    const latest = renderProvider();

    await act(async () => {
      const result = await latest.current?.refresh({ source: 'manual' });
      expect(result?.success).toBe(true);
    });

    await waitFor(() => {
      expect(latest.current?.plan?.collaborators).toEqual([]);
    });

    expect(fetchPlanMock).toHaveBeenCalledTimes(1);
    expect(latest.current?.latestVersion).toBe(5);
    expect(latest.current?.error).toBeNull();
    expect(latest.current?.plan?.appointments).toEqual([]);
    expect(latest.current?.plan?.bills).toEqual([]);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'plan_cache_v1',
      expect.stringContaining('"planVersion":5')
    );
  });

  it('records an error when all plan refresh attempts fail', async () => {
    fetchPlanMock.mockRejectedValue(new Error('network down'));

    const latest = renderProvider();

    await act(async () => {
      const result = await latest.current?.refresh({ source: 'manual' });
      expect(result?.success).toBe(false);
    });

    await waitFor(() => {
      expect(latest.current?.error).toContain('We couldn’t refresh your plan');
    });

    expect(fetchPlanMock).toHaveBeenCalledTimes(3);
  });

  it('responds to realtime events by pulling remote changes when version increases', async () => {
    const initialPlan = createPlan({ planVersion: 1 });
    fetchPlanMock.mockResolvedValueOnce(initialPlan);

    const updatedPlan = createPlan({ planVersion: 2 });
    fetchPlanMock.mockResolvedValueOnce(updatedPlan);
    fetchPlanVersionMock.mockResolvedValueOnce(2);

    const latest = renderProvider();

    await act(async () => {
      await latest.current?.refresh({ source: 'manual' });
    });

    expect(latest.current?.latestVersion).toBe(1);

    listeners.forEach((listener) => listener());

    await waitFor(() => {
      expect(fetchPlanVersionMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(latest.current?.latestVersion).toBe(2);
    });

    expect(fetchPlanMock).toHaveBeenCalledTimes(2);
  });
});
