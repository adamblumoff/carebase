import React from 'react';
import { render, waitFor, act } from '@testing-library/react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlanPayload } from '@carebase/shared';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { PlanProvider, usePlan } from '../PlanProvider';
import { AuthContext } from '../../auth/AuthContext';

type Listener = () => void;

const fetchPlanMock = vi.fn<[], Promise<PlanPayload>>();
const fetchPlanVersionMock = vi.fn<[], Promise<number>>();
const addPlanChangeListenerMock = vi.fn<(listener: Listener) => () => void>();
const ensureRealtimeConnectedMock = vi.fn<[], Promise<void>>();
const isRealtimeConnectedMock = vi.fn<[], boolean>();
const addPlanDeltaListenerMock = vi.fn<(listener: (delta: unknown) => void) => () => void>();

vi.mock('expo-secure-store', () => ({
  isAvailableAsync: vi.fn().mockResolvedValue(false),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
}));

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
  addPlanDeltaListener: (listener: (delta: unknown) => void) => addPlanDeltaListenerMock(listener),
  addRealtimeStatusListener: () => () => {},
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

type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

function renderProvider(initialStatus: AuthStatus = 'signedIn') {
  const latestValue: { current: ReturnType<typeof usePlan> | null } = { current: null };

  function Capture() {
    const value = usePlan();
    latestValue.current = value;
    return null;
  }

  function Wrapper({ status }: { status: AuthStatus }) {
    const authValue = React.useMemo(
      () => ({
        status,
        user: null,
        signIn: () => {},
        signOut: async () => {},
      }),
      [status]
    );

    return (
      <AuthContext.Provider value={authValue}>
        <PlanProvider>
          <Capture />
        </PlanProvider>
      </AuthContext.Provider>
    );
  }

  const utils = render(<Wrapper status={initialStatus} />);

  return {
    latestValue,
    setStatus: (nextStatus: AuthStatus) => utils.rerender(<Wrapper status={nextStatus} />),
  };
}

describe('PlanProvider', () => {
  const listeners: Listener[] = [];
  const deltaListeners: Array<(delta: unknown) => void> = [];

  beforeEach(async () => {
    fetchPlanMock.mockReset();
    fetchPlanVersionMock.mockReset();
    ensureRealtimeConnectedMock.mockReset();
    isRealtimeConnectedMock.mockReset();
    addPlanChangeListenerMock.mockReset();
    addPlanDeltaListenerMock.mockReset();
    listeners.length = 0;
    deltaListeners.length = 0;

    addPlanChangeListenerMock.mockImplementation((listener: Listener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      };
    });

    addPlanDeltaListenerMock.mockImplementation((listener: (delta: unknown) => void) => {
      deltaListeners.push(listener);
      return () => {
        const index = deltaListeners.indexOf(listener);
        if (index >= 0) {
          deltaListeners.splice(index, 1);
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

    const { latestValue } = renderProvider();

    await act(async () => {
      const result = await latestValue.current?.refresh({ source: 'manual' });
      expect(result?.success).toBe(true);
    });

    await waitFor(() => {
      expect(latestValue.current?.plan?.collaborators).toEqual([]);
    });

    expect(fetchPlanMock).toHaveBeenCalledTimes(1);
    expect(latestValue.current?.latestVersion).toBe(5);
    expect(latestValue.current?.error).toBeNull();
    expect(latestValue.current?.plan?.appointments).toEqual([]);
    expect(latestValue.current?.plan?.bills).toEqual([]);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      'plan_cache_v1',
      expect.stringContaining('"planVersion":5')
    );
  });

  it('records an error when all plan refresh attempts fail', async () => {
    fetchPlanMock.mockRejectedValue(new Error('network down'));

    const { latestValue } = renderProvider();

    await act(async () => {
      const result = await latestValue.current?.refresh({ source: 'manual' });
      expect(result?.success).toBe(false);
    });

    await waitFor(() => {
      expect(latestValue.current?.error).toContain('We couldn’t refresh your plan');
    });

    expect(fetchPlanMock).toHaveBeenCalledTimes(3);
  });

  it('responds to realtime events by pulling remote changes when version increases', async () => {
    const initialPlan = createPlan({ planVersion: 1 });
    fetchPlanMock.mockResolvedValueOnce(initialPlan);

    const updatedPlan = createPlan({ planVersion: 2 });
    fetchPlanMock.mockResolvedValueOnce(updatedPlan);
    fetchPlanVersionMock.mockResolvedValueOnce(2);

    const { latestValue } = renderProvider();

    await act(async () => {
      await latestValue.current?.refresh({ source: 'manual' });
    });

    expect(latestValue.current?.latestVersion).toBe(1);

    listeners.forEach((listener) => listener());

    await waitFor(() => {
      expect(fetchPlanVersionMock).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(latestValue.current?.latestVersion).toBe(2);
    });

    expect(fetchPlanMock).toHaveBeenCalledTimes(2);
  });

  it('skips plan fetches while the user is signed out', async () => {
    const { latestValue, setStatus } = renderProvider('signedOut');

    await act(async () => {
      const result = await latestValue.current?.refresh({ source: 'manual' });
      expect(result?.success).toBe(false);
    });

    expect(fetchPlanMock).not.toHaveBeenCalled();
    expect(fetchPlanVersionMock).not.toHaveBeenCalled();

    fetchPlanMock.mockResolvedValue(createPlan({ planVersion: 3 }));

    await act(async () => {
      setStatus('signedIn');
    });

    // allow effects to settle; depending on environment we may or may not fetch immediately
    await Promise.resolve();
    const initialCalls = fetchPlanMock.mock.calls.length;

    await act(async () => {
      const result = await latestValue.current?.refresh({ source: 'manual' });
      expect(result?.success).toBe(true);
    });

    expect(fetchPlanMock).toHaveBeenCalledTimes(initialCalls + 1);
  });

  it('falls back to full refresh when delta cannot be applied', async () => {
    const plan = createPlan();
    fetchPlanMock.mockResolvedValue(plan);

    const { latestValue } = renderProvider();

    await act(async () => {
      const result = await latestValue.current?.refresh({ source: 'manual' });
      expect(result?.success).toBe(true);
    });

    fetchPlanMock.mockClear();

    const delta = {
      itemType: 'bill',
      entityId: 999,
      action: 'updated'
    };

    await act(async () => {
      deltaListeners.forEach((listener) => listener(delta));
    });

    await waitFor(() => {
      expect(fetchPlanMock).toHaveBeenCalledTimes(1);
    });

    expect(latestValue.current?.plan).toEqual(plan);
  });
});
