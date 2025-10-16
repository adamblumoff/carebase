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
import type { PlanPayload } from '@carebase/shared';
import { fetchPlan, fetchPlanVersion } from '../api/plan';
import { addPlanChangeListener } from '../utils/planEvents';
import { ensureRealtimeConnected, isRealtimeConnected } from '../utils/realtime';

type RefreshSource = 'initial' | 'manual' | 'poll' | 'realtime';

interface RefreshOptions {
  source?: RefreshSource;
  silent?: boolean;
}

interface PlanUpdateMeta {
  source: RefreshSource;
  success: boolean;
  timestamp: number;
}

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

export function PlanProvider({ children }: { children: React.ReactNode }) {
  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<PlanUpdateMeta | null>(null);
  const latestVersionRef = useRef<number>(0);
  const cacheLoadedRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchPromiseRef = useRef<Promise<void> | null>(null);

  const setPlanData = useCallback((nextPlan: PlanPayload) => {
    const normalized = normalizePlanPayload(nextPlan);
    setPlan(normalized);
    latestVersionRef.current =
      typeof normalized.planVersion === 'number' ? normalized.planVersion : 0;
    AsyncStorage.setItem(PLAN_CACHE_KEY, JSON.stringify(normalized)).catch(() => {
      // cache failures are non-blocking
    });
  }, []);

  const refresh = useCallback(
    async (options: RefreshOptions = {}) => {
      const { source = 'manual', silent = false } = options;
      if (fetchPromiseRef.current) {
        await fetchPromiseRef.current;
        return { success: true };
      }

      if (!silent && plan === null) {
        setLoading(true);
      }
      if (source === 'manual') {
        setRefreshing(true);
      }

      const fetchPromise = (async () => {
        let success = false;
        try {
          for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
            try {
              const data = normalizePlanPayload(await fetchPlan());
              setPlanData(data);
              setError(null);
              success = true;
              break;
            } catch (err) {
              if (attempt < MAX_FETCH_ATTEMPTS) {
                await sleep(RETRY_DELAY_MS * attempt);
              }
            }
          }
          if (!success) {
            setError('We couldn’t refresh your plan. Pull to try again.');
          }
        } finally {
          if (!silent && plan === null) {
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
    [plan, setPlanData]
  );

  useEffect(() => {
    let cancelled = false;

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
  }, [refresh]);

  useEffect(() => {
    const unsubscribePlan = addPlanChangeListener(() => {
      refresh({ silent: true, source: 'realtime' }).catch(() => {
        // errors handled in refresh
      });
    });

    if (process.env.NODE_ENV !== 'test') {
      ensureRealtimeConnected().catch((err) => {
        console.warn('Realtime connection failed', err);
      });
    }

    return () => {
      unsubscribePlan();
    };
  }, [refresh]);

  const schedulePoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
    }

    pollTimerRef.current = setTimeout(async () => {
      try {
        if (isRealtimeConnected()) {
          return;
        }
        const nextVersion = await fetchPlanVersion();
        if (nextVersion > latestVersionRef.current) {
          await refresh({ silent: true, source: 'poll' });
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'test') {
          console.warn('Plan version poll failed', err);
        }
      } finally {
        schedulePoll();
      }
    }, VERSION_POLL_INTERVAL_MS);
  }, [refresh]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') {
      return () => {
        if (pollTimerRef.current) {
          clearTimeout(pollTimerRef.current);
        }
      };
    }

    schedulePoll();
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
      }
    };
  }, [schedulePoll]);

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

export function usePlan(): PlanContextValue {
  const context = useContext(PlanContext);
  if (!context) {
    throw new Error('usePlan must be used within a PlanProvider');
  }
  return context;
}
