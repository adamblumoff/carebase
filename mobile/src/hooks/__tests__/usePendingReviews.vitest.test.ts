import { renderHook, waitFor, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingReviewItem, PlanItemDelta } from '@carebase/shared';
import { usePendingReviews } from '../usePendingReviews';

const fetchPendingReviewsMock = vi.fn();
const approveMock = vi.fn();
const saveDraftMock = vi.fn();
const rejectMock = vi.fn();
const deltaListeners: Array<(delta: PlanItemDelta) => void> = [];

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ status: 'signedIn' as const })
}));

vi.mock('../../api/review', () => ({
  fetchPendingReviews: () => fetchPendingReviewsMock(),
  approvePendingReview: (...args: any[]) => approveMock(...args),
  savePendingReviewDraft: (...args: any[]) => saveDraftMock(...args),
  rejectPendingReview: (...args: any[]) => rejectMock(...args)
}));

vi.mock('../../utils/planEvents', () => ({
  addPlanChangeListener: () => () => {},
  emitPlanChanged: () => {}
}));

vi.mock('../../utils/realtime', () => ({
  addPlanDeltaListener: (listener: (delta: PlanItemDelta) => void) => {
    deltaListeners.push(listener);
    return () => {
      const idx = deltaListeners.indexOf(listener);
      if (idx >= 0) {
        deltaListeners.splice(idx, 1);
      }
    };
  }
}));

describe('usePendingReviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deltaListeners.length = 0;
    const initialItems: PendingReviewItem[] = [
      {
        itemId: 1,
        detectedType: 'bill',
        confidence: 0.9,
        createdAt: new Date().toISOString(),
        recipient: { id: 10, displayName: 'Alex' },
        source: { id: 5, subject: null, sender: null, shortExcerpt: null, storageKey: null },
        draft: null
      }
    ];
    fetchPendingReviewsMock.mockResolvedValueOnce({ items: initialItems });
  });

  it('reloads pending reviews when relevant delta arrives', async () => {
    const nextItems: PendingReviewItem[] = [
      {
        itemId: 2,
        detectedType: 'bill',
        confidence: 0.95,
        createdAt: new Date().toISOString(),
        recipient: { id: 10, displayName: 'Alex' },
        source: { id: 7, subject: null, sender: null, shortExcerpt: null, storageKey: null },
        draft: null
      }
    ];
    fetchPendingReviewsMock.mockResolvedValueOnce({ items: nextItems });

    const { result } = renderHook(() => usePendingReviews());

    await waitFor(() => {
      expect(fetchPendingReviewsMock).toHaveBeenCalledTimes(1);
      expect(result.current.items).toHaveLength(1);
    });

    await act(async () => {
      deltaListeners.forEach((listener) =>
        listener({ itemType: 'bill', entityId: 2, action: 'created' } as PlanItemDelta)
      );
    });

    await waitFor(() => {
      expect(fetchPendingReviewsMock).toHaveBeenCalledTimes(2);
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0].itemId).toBe(2);
    });
  });
});
