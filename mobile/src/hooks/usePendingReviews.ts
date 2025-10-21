import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingReviewDraft, PendingReviewItem } from '@carebase/shared';
import { useAuth } from '../auth/AuthContext';
import {
  fetchPendingReviews,
  approvePendingReview,
  savePendingReviewDraft,
  rejectPendingReview,
  type ReviewBillPayload
} from '../api/review';
import { addPlanChangeListener, emitPlanChanged } from '../utils/planEvents';

interface PendingReviewState {
  items: PendingReviewItem[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

export interface PendingReviewActions {
  items: PendingReviewItem[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  pendingCount: number;
  refresh: (options?: { silent?: boolean }) => Promise<void>;
  approve: (itemId: number, bill: ReviewBillPayload) => Promise<any>;
  saveDraft: (itemId: number, bill: ReviewBillPayload) => Promise<PendingReviewDraft>;
  reject: (itemId: number, reason?: string | null) => Promise<void>;
}

export function usePendingReviews(): PendingReviewActions {
  const { status } = useAuth();
  const [state, setState] = useState<PendingReviewState>({
    items: [],
    loading: true,
    refreshing: false,
    error: null,
  });
  const fetchPromiseRef = useRef<Promise<void> | null>(null);

  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (status !== 'signedIn') {
        setState({ items: [], loading: false, refreshing: false, error: null });
        return;
      }

      if (fetchPromiseRef.current) {
        await fetchPromiseRef.current;
        return;
      }

      const promise = (async () => {
        try {
          setState((prev) => ({
            ...prev,
            loading: silent ? prev.loading : true,
            refreshing: !silent,
            error: null,
          }));
          const response = await fetchPendingReviews();
          setState({
            items: response.items,
            loading: false,
            refreshing: false,
            error: null,
          });
        } catch (error) {
          console.error('[Review] Failed to load pending reviews', error);
          setState((prev) => ({
            ...prev,
            loading: false,
            refreshing: false,
            error: 'Unable to load pending reviews right now.',
          }));
        } finally {
          fetchPromiseRef.current = null;
        }
      })();

      fetchPromiseRef.current = promise;
      await promise;
    },
    [status]
  );

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    if (status !== 'signedIn') {
      return undefined;
    }

    const unsubscribe = addPlanChangeListener(() => {
      load({ silent: true }).catch(() => {});
    });
    return unsubscribe;
  }, [load, status]);

  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      await load({ silent });
    },
    [load]
  );

  const approve = useCallback(
    async (itemId: number, bill: ReviewBillPayload) => {
      const result = await approvePendingReview(itemId, bill);
      setState((prev) => ({
        ...prev,
        items: prev.items.filter((item) => item.itemId !== itemId),
      }));
      emitPlanChanged();
      return result;
    },
    []
  );

  const saveDraft = useCallback(async (itemId: number, bill: ReviewBillPayload) => {
    const draft = await savePendingReviewDraft(itemId, bill);
    setState((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.itemId === itemId
          ? {
              ...item,
              draft,
            }
          : item
      ),
    }));
    return draft;
  }, []);

  const reject = useCallback(async (itemId: number, reason?: string | null) => {
    await rejectPendingReview(itemId, reason);
    setState((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item.itemId !== itemId),
    }));
    emitPlanChanged();
  }, []);

  return {
    items: state.items,
    loading: state.loading,
    refreshing: state.refreshing,
    error: state.error,
    pendingCount: state.items.length,
    refresh,
    approve,
    saveDraft,
    reject,
  };
}
