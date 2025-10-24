import type { PendingReviewDraft, PendingReviewListResponse, BillStatus } from '@carebase/shared';
import apiClient from './client';
import { API_ENDPOINTS } from '../config/apiEndpoints';

export interface ReviewBillPayload {
  amount?: number | null;
  dueDate?: string | null;
  statementDate?: string | null;
  payUrl?: string | null;
  status?: BillStatus | null;
  notes?: string | null;
}

export async function fetchPendingReviews(): Promise<PendingReviewListResponse> {
  const response = await apiClient.get<PendingReviewListResponse>(API_ENDPOINTS.review.pending);
  return response.data;
}

export async function savePendingReviewDraft(
  itemId: number,
  bill: ReviewBillPayload
): Promise<PendingReviewDraft> {
  const response = await apiClient.patch<{ status: 'saved'; draft: PendingReviewDraft }>(
    API_ENDPOINTS.review.item(itemId),
    {
      action: 'save',
      bill,
    }
  );
  return response.data.draft;
}

export async function approvePendingReview(
  itemId: number,
  bill: ReviewBillPayload
) {
  const response = await apiClient.patch<{ status: 'approved'; bill: any }>(
    API_ENDPOINTS.review.item(itemId),
    {
      action: 'approve',
      bill,
    }
  );
  return response.data.bill;
}

export async function rejectPendingReview(itemId: number, reason?: string | null): Promise<void> {
  await apiClient.patch(API_ENDPOINTS.review.item(itemId), {
    action: 'reject',
    reason: reason ?? null,
  });
}
