import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@carebase/shared';
import {
  listPendingReviews,
  saveBillDraft,
  approvePendingBill,
  rejectPendingItem
} from '../reviewService.js';
import { NotFoundError, ValidationError } from '../../utils/errors.js';

const queriesMock = vi.hoisted(() => ({
  listPendingReviewItemsForUser: vi.fn(),
  getPendingReviewItemForUser: vi.fn(),
  upsertBillDraft: vi.fn(),
  deleteBillDraft: vi.fn(),
  getBillDraftByItemId: vi.fn(),
  updateItemReviewStatus: vi.fn(),
  createBill: vi.fn(),
  createAuditLog: vi.fn(),
  reclassifyItem: vi.fn()
}));

vi.mock('../../db/queries.js', () => queriesMock);

const {
  listPendingReviewItemsForUser,
  getPendingReviewItemForUser,
  upsertBillDraft,
  deleteBillDraft,
  getBillDraftByItemId,
  updateItemReviewStatus,
  createBill,
  createAuditLog,
  reclassifyItem
} = queriesMock;

function createRow(overrides: Partial<Record<string, any>> = {}) {
  return {
    item_id: 5,
    recipient_id: 9,
    recipient_name: 'Alex Patient',
    source_id: 77,
    source_subject: 'Statement',
    source_sender: 'clinic@example.com',
    source_short_excerpt: 'Balance due',
    source_storage_key: 'storage://email',
    detected_type: 'bill',
    confidence: '0.82',
    created_at: new Date('2025-10-23T12:00:00Z'),
    draft_amount: '42.50',
    draft_due_date: new Date('2025-10-25'),
    draft_statement_date: null,
    draft_pay_url: 'https://pay.example.com',
    draft_status: 'todo',
    draft_notes: 'verify code',
    ...overrides
  };
}

const user: User = {
  id: 1,
  email: 'owner@example.com',
  googleId: 'google-1',
  legacyGoogleId: 'google-1',
  clerkUserId: 'clerk_1',
  forwardingAddress: 'owner-forward@example.com',
  planSecret: 'secret',
  planVersion: 3,
  planUpdatedAt: new Date(),
  createdAt: new Date(),
  passwordResetRequired: false
};

describe('reviewService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('listPendingReviews maps rows to payload', async () => {
    listPendingReviewItemsForUser.mockResolvedValueOnce([
      createRow(),
      createRow({
        item_id: 6,
        draft_amount: null,
        draft_due_date: null,
        draft_pay_url: null,
        draft_notes: null,
        draft_status: null
      })
    ]);

    const response = await listPendingReviews(user);

    expect(listPendingReviewItemsForUser).toHaveBeenCalledWith(user.id);
    expect(response.items).toHaveLength(2);
    expect(response.items[0]).toMatchObject({
      itemId: 5,
      detectedType: 'bill',
      confidence: 0.82,
      draft: {
        amount: 42.5,
        dueDate: '2025-10-25',
        status: 'todo',
        notes: 'verify code'
      }
    });
    expect(response.items[1]?.draft).toBeNull();
  });

  it('saveBillDraft persists merged draft and returns normalized fields', async () => {
    getPendingReviewItemForUser.mockResolvedValueOnce(createRow());
    upsertBillDraft.mockResolvedValueOnce(undefined);
    getBillDraftByItemId.mockResolvedValueOnce({
      amount: '99.99',
      due_date: new Date('2025-10-30'),
      statement_date: new Date('2025-10-20'),
      pay_url: 'https://pay.example.com/new',
      status: 'overdue',
      notes: 'updated'
    });

    const result = await saveBillDraft(user, 5, { amount: 99.99, status: 'overdue' });

    expect(getPendingReviewItemForUser).toHaveBeenCalledWith(user.id, 5);
    expect(upsertBillDraft).toHaveBeenCalledWith(
      5,
      expect.objectContaining({
        amount: 99.99,
        status: 'overdue'
      })
    );
    expect(result).toEqual({
      amount: 99.99,
      dueDate: '2025-10-30',
      statementDate: '2025-10-20',
      payUrl: 'https://pay.example.com/new',
      status: 'overdue',
      notes: 'updated'
    });
  });

  it('saveBillDraft throws when pending item missing', async () => {
    getPendingReviewItemForUser.mockResolvedValueOnce(null);

    await expect(saveBillDraft(user, 999, {})).rejects.toBeInstanceOf(NotFoundError);
    expect(upsertBillDraft).not.toHaveBeenCalled();
  });

  it('approvePendingBill creates bill, clears draft, and logs audit', async () => {
    getPendingReviewItemForUser.mockResolvedValueOnce(createRow());
    createBill.mockResolvedValueOnce({ id: 22, amount: 42.5 });

    const bill = await approvePendingBill(user, 5, { amount: 42.5 });

    expect(getPendingReviewItemForUser).toHaveBeenCalledWith(user.id, 5);
    expect(updateItemReviewStatus).toHaveBeenCalledWith(5, 'auto');
    expect(createBill).toHaveBeenCalledWith(5, {
      amount: 42.5,
      dueDate: '2025-10-25',
      statementDate: undefined,
      payUrl: 'https://pay.example.com',
      status: 'todo'
    });
    expect(deleteBillDraft).toHaveBeenCalledWith(5);
    expect(createAuditLog).toHaveBeenCalledWith(5, 'review_approved', expect.objectContaining({
      billId: 22,
      reviewerId: user.id
    }));
    expect(bill).toEqual({ id: 22, amount: 42.5 });
  });

  it('approvePendingBill validates amount before creating bill', async () => {
    getPendingReviewItemForUser.mockResolvedValueOnce(
      createRow({ draft_amount: null })
    );

    await expect(approvePendingBill(user, 5, {})).rejects.toBeInstanceOf(ValidationError);
    expect(createBill).not.toHaveBeenCalled();
  });

  it('rejectPendingItem reclassifies item and records audit log', async () => {
    getPendingReviewItemForUser.mockResolvedValueOnce(createRow());

    await rejectPendingItem(user, 5, 'duplicate');

    expect(deleteBillDraft).toHaveBeenCalledWith(5);
    expect(reclassifyItem).toHaveBeenCalledWith(5, 'noise');
    expect(createAuditLog).toHaveBeenCalledWith(5, 'review_rejected', {
      reason: 'duplicate',
      reviewerId: user.id
    });
  });
});
