import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlanPayload, PlanItemDelta, BillPayload, AppointmentPayload } from '@carebase/shared';
import { fetchPlan, fetchPlanVersion } from '../api/plan';
import { addPlanChangeListener } from '../utils/planEvents';
import { ensureRealtimeConnected, isRealtimeConnected, addPlanDeltaListener } from '../utils/realtime';
import { useAuth } from '../auth/AuthContext';

type RefreshSource = 'initial' | 'manual' | 'poll' | 'realtime';

interface RefreshOptions {
  source?: RefreshSource;
  silent?: boolean;
}

export type PlanUpdateMeta = {
  source: RefreshSource;
  success: boolean;
  timestamp: number;
};

interface PlanContextValue {
  plan: PlanPayload | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  latestVersion: number;
  refresh: (options?: RefreshOptions) => Promise<{ success: boolean }>;
  lastUpdate: PlanUpdateMeta | null;
}

const PLAN_CACHE_KEY = 'plan_cache_v1';
const MAX_FETCH_ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;
const VERSION_POLL_INTERVAL_MS = 15000;

const PlanContext = createContext<PlanContextValue | null>(null);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizePlanPayload = (payload: PlanPayload): PlanPayload => ({
  ...payload,
  collaborators: Array.isArray(payload.collaborators) ? payload.collaborators : [],
  appointments: Array.isArray(payload.appointments) ? payload.appointments : [],
  bills: Array.isArray(payload.bills) ? payload.bills : [],
});

type PlanDraft = PlanPayload | null;

function upsertPlanWithDelta(plan: PlanDraft, delta: PlanItemDelta): PlanDraft {
  if (!plan) {
    return null;
  }

  const next: PlanPayload = {
    ...plan,
    appointments: [...plan.appointments],
    bills: [...plan.bills]
  };

  const applyUpdatedVersion = (version?: number) => {
    if (typeof version === 'number' && version > next.planVersion) {
      next.planVersion = version;
    }
  };

  applyUpdatedVersion(delta.version);

  const normalizeDeltaAppointment = (data: unknown): AppointmentPayload | null => {
    if (!data || typeof data !== 'object' || !('appointment' in (data as any))) {
      return null;
    }
    const value = (data as { appointment?: AppointmentPayload }).appointment;
    return value ? { ...value } : null;
  };

  const normalizeDeltaBill = (data: unknown): BillPayload | null => {
    if (!data || typeof data !== 'object' || !('bill' in (data as any))) {
      return null;
    }
    const value = (data as { bill?: BillPayload }).bill;
    return value ? { ...value } : null;
  };

  try {
    if (delta.itemType === 'appointment') {
      const appointmentData = normalizeDeltaAppointment(delta.data);
      const index = next.appointments.findIndex((a) => a.id === delta.entityId);

      if (delta.action === 'deleted') {
        if (index !== -1) {
          next.appointments.splice(index, 1);
          return next;
        }
        return plan;
      }

      if (!appointmentData) {
        return plan;
      }

      if (index === -1) {
        next.appointments.unshift(appointmentData);
      } else {
        next.appointments[index] = appointmentData;
      }
      return next;
    }

    if (delta.itemType === 'bill') {
      const billData = normalizeDeltaBill(delta.data);
      const index = next.bills.findIndex((b) => b.id === delta.entityId);

      if (delta.action === 'deleted') {
        if (index !== -1) {
          next.bills.splice(index, 1);
          return next;
        }
        return plan;
      }

      if (!billData) {
        return plan;
      }

      if (index === -1) {
        next.bills.unshift(billData);
      } else {
        next.bills[index] = billData;
      }
      return next;
    }
  } catch (error) {
    console.warn('Failed to apply plan delta', error);
    return plan;
  }

  return plan;
}

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus } = useAuth();
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<PlanUpdateMeta | null>(null);
  const latestVersionRef = useRef<number>(0);
  const cacheLoadedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchPromiseRef = useRef<Promise<void> | null>(null);
  const hasPlanRef = useRef(false);
  const isSignedInRef = useRef(authStatus === 'signedIn');

  const setPlanData = useCallback((nextPlan: PlanPayload) => {
    const normalized = normalizePlanPayload(nextPlan);
    setPlan(normalized);
    latestVersionRef.current =
      typeof normalized.planVersion === 'number' ? normalized.planVersion : 0;
    AsyncStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(normalized)).catch(() => {
      // cache failures are non-blocking
    });
  }, []);

  useEffect(() => {
    isSignedInRef.current = authStatus === 'signedIn';
  }, [authStatus]);

  useEffect(() => {
    hasPlanRef.current = plan !== null;
  }, [plan]);

  const refresh = useCallback(
    async (options: RefreshOptions = {}) => {
      const { source = 'manual', silent = false } = options;
      if (fetchPromiseRef.current) {
        await fetchPromiseRef.current;
        return { success: true };
      }

      if (!isSignedInRef.current) {
        if (!silent && !hasPlanRef.current) {
          setLoading(false);
        }
        if (source === 'manual') {
          setRefreshing(false);
        }
        const timestamp = Date.now();
        setLastUpdate({ source, success: false, timestamp });
        return { success: false };
      }

      if (!silent && !hasPlanRef.current) {
        setLoading(true);
      }
      if (source === 'manual') {
        setRefreshing(true);
      }

      const fetchPromise = (async () => {
        let success = false;
        try {
          if (!isSignedInRef.current) {
            return;
          }

          for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
            try {
              const data = normalizePlanPayload(await fetchPlan());
              setPlanData(data);
              setError(null);
              success = true;
              break;
              } catch (err) {
                if (attempt < MAX_FETCH_ATTEMPTS) {
                  const delay =
                    process.env.NODE_ENV === 'test' ? 0 : RETRY_DELAY_MS * attempt;
                  if (delay > 0) {
                    await sleep(delay);
                  }
                }
              }
            }
          if (!success) {
            setError('We couldn’t refresh your plan. Pull to try again.');
          }
        } finally {
          if (!silent && !hasPlanRef.current) {
            setLoading(false);
          }
          if (source === 'manual') {
            setRefreshing(false);
          }
          setLastUpdate({ source, success, timestamp: Date.now() });
          fetchPromiseRef.current = null;
        }
        return { success };
      })();

      fetchPromiseRef.current = fetchPromise;
      return fetchPromise;
    },
    [setPlanData]
  );

  const refreshIfVersionChanged = useCallback(
    async (source: RefreshSource) => {
      if (!isSignedInRef.current) {
        return;
      }

      try {
        const nextVersion = await fetchPlanVersion();
        if (nextVersion > latestVersionRef.current) {
          await refresh({ source, silent: true });
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('Failed to check plan version', err);
        }
      }
    },
    [refresh]
  );

  useEffect(() => {
    let cancelled = false;

    if (authStatus === 'signedOut') {
      hasPlanRef.current = false;
      cacheLoadedRef.current = false;
      latestVersionRef.current = 0;
      setPlan(null);
      setError(null);
      setRefreshing(false);
      setLoading(false);
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return () => {
        cancelled = true;
      };
    }

    if (authStatus !== 'signedIn') {
      return () => {
        cancelled = true;
      };
    }

    const loadCacheAndFetch = async () => {
      if (process.env.NODE_ENV === 'test') {
        setLoading(false);
        return;
      }

      try {
        const cached = await AsyncStorage.getItem(PLAN_CACHE_KEY);
        if (cached && !cancelled) {
          const parsed = normalizePlanPayload(JSON.parse(cached));
          cacheLoadedRef.current = true;
          setPlan(parsed);
          latestVersionRef.current =
            typeof parsed.planVersion === 'number' ? parsed.planVersion : 0;
          setLoading(false);
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('Failed to load cached plan', err);
        }
      }

      if (!cancelled) {
        await refresh({ silent: cacheLoadedRef.current, source: 'initial' });
        if (!cacheLoadedRef.current) {
          setLoading(false);
        }
      }
    };

    loadCacheAndFetch();

    return () => {
      cancelled = true;
    };
  }, [authStatus, refresh]);

  useEffect(() => {
    if (authStatus !== 'signedIn') {
      return;
    }

    const unsubscribePlan = addPlanChangeListener(() => {
      refreshIfVersionChanged('realtime').catch(() => {
        // handled in helper
      });
    });

    const unsubscribeDelta = addPlanDeltaListener((delta) => {
      latestVersionRef.current = Math.max(latestVersionRef.current, delta.version ?? latestVersionRef.current);

      setPlan((prev) => {
        const next = upsertPlanWithDelta(prev, delta);
        if (next === prev) {
          refresh({ source: 'realtime', silent: true }).catch(() => {
            // ignore
          });
          return prev;
        }

        return next;
      });
    });

    if (process.env.NODE_ENV !== 'test') {
      ensureRealtimeConnected().catch((err) => {
        console.warn('Realtime connection failed', err);
      });
    }

    return () => {
      unsubscribePlan();
      unsubscribeDelta();
    };
  }, [authStatus, refreshIfVersionChanged, refresh]);

  const schedulePoll = useCallback(() => {
    if (!isSignedInRef.current) {
      return;
    }
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }

    pollTimerRef.current = setTimeout(async () => {
      try {
        if (!isSignedInRef.current) {
          return;
        }
        if (isRealtimeConnected()) {
          return;
        }
        await refreshIfVersionChanged('poll');
      } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('Plan version poll failed', err);
        }
      } finally {
        schedulePoll();
      }
    }, VERSION_POLL_INTERVAL_MS);
  }, [refreshIfVersionChanged]);

  useEffect(() => {
    if (authStatus !== 'signedIn') {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return () => {
        if (pollTimerRef.current) {
          clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };
    }

    if (process.env.NODE_ENV === 'test') {
      return () => {
        if (pollTimerRef.current) {
          clearTimeout(pollTimerRef.current);
          pollTimerRef.current = null;
        }
      };
    }

    schedulePoll();
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [authStatus, schedulePoll]);

  const contextValue = useMemo<PlanContextValue>(
    () => ({
      plan,
      loading,
      refreshing,
      error,
      latestVersion: latestVersionRef.current,
      refresh,
      lastUpdate,
    }),
    [plan, loading, refreshing, error, refresh, lastUpdate]
  );

  return <PlanContext.Provider value={contextValue}>{children}</PlanContext.Provider>;
}

export const __testUpsertPlanWithDelta = upsertPlanWithDelta;

export function usePlan(): PlanContextValue {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error('usePlan must be used within a PlanProvider');
  }
  return context;
}
