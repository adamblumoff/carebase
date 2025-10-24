import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchPendingReviews,
  savePendingReviewDraft,
  approvePendingReview,
  rejectPendingReview,
} from '../review';
import { API_ENDPOINTS } from '../../config/apiEndpoints';

const getMock = vi.fn();
const patchMock = vi.fn();

vi.mock('../client', () => ({
  default: {
    get: (...args: unknown[]) => getMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
  },
}));

describe('review API', () => {
  beforeEach(() => {
    getMock.mockReset();
    patchMock.mockReset();
  });

  it('fetches pending reviews', async () => {
    const payload = { items: [] };
    getMock.mockResolvedValue({ data: payload });

    const result = await fetchPendingReviews();

    expect(getMock).toHaveBeenCalledWith(API_ENDPOINTS.review.pending);
    expect(result).toBe(payload);
  });

  it('saves a review draft', async () => {
    const draft = { amount: 120, dueDate: '2025-10-30', statementDate: null, payUrl: null, status: 'todo', notes: null };
    patchMock.mockResolvedValue({ data: { status: 'saved', draft } });

    const result = await savePendingReviewDraft(5, { amount: 120 });

    expect(patchMock).toHaveBeenCalledWith(API_ENDPOINTS.review.item(5), {
      action: 'save',
      bill: { amount: 120 },
    });
    expect(result).toBe(draft);
  });

  it('approves a pending review', async () => {
    const bill = { id: 10 };
    patchMock.mockResolvedValue({ data: { status: 'approved', bill } });

    const result = await approvePendingReview(7, { amount: 88.5 });

    expect(patchMock).toHaveBeenCalledWith(API_ENDPOINTS.review.item(7), {
      action: 'approve',
      bill: { amount: 88.5 },
    });
    expect(result).toBe(bill);
  });

  it('rejects a pending review', async () => {
    patchMock.mockResolvedValue({ data: { status: 'rejected' } });

    await rejectPendingReview(11, 'not a medical bill');

    expect(patchMock).toHaveBeenCalledWith(API_ENDPOINTS.review.item(11), {
      action: 'reject',
      reason: 'not a medical bill',
    });
  });
});
