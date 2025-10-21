import type {
  Bill,
  BillCreateRequest,
  BillStatus,
  PendingReviewItem,
  PendingReviewListResponse,
  PendingReviewDraft
} from '@carebase/shared';
import type { User } from '@carebase/shared';
import {
  listPendingReviewItemsForUser,
  getPendingReviewItemForUser,
  upsertBillDraft,
  deleteBillDraft,
  getBillDraftByItemId,
  updateItemReviewStatus,
  createBill,
  createAuditLog,
  reclassifyItem
} from '../db/queries.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

function toIsoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().split('T')[0] ?? null;
}

function parseDraftAmount(amount: string | number | null): number | null {
  if (amount === null || amount === undefined) return null;
  const numeric = typeof amount === 'string' ? parseFloat(amount) : amount;
  return Number.isFinite(numeric) ? numeric : null;
}

function coerceBillStatus(status: BillStatus | null | undefined): BillStatus {
  if (status === 'overdue' || status === 'paid') {
    return status;
  }
  return 'todo';
}

interface InternalPendingReviewItem {
  itemId: number;
  detectedType: string;
  confidence: number;
  createdAt: Date;
  recipient: { id: number; displayName: string };
  source: {
    id: number;
    subject: string | null;
    sender: string | null;
    shortExcerpt: string | null;
    storageKey: string | null;
  };
  draft: PendingReviewDraft | null;
}

function mapPendingRow(row: {
  item_id: number;
  recipient_id: number;
  recipient_name: string;
  source_id: number;
  source_subject: string | null;
  source_sender: string | null;
  source_short_excerpt: string | null;
  source_storage_key: string | null;
  detected_type: string;
  confidence: number | string;
  created_at: Date;
  draft_amount: string | null;
  draft_due_date: Date | null;
  draft_statement_date: Date | null;
  draft_pay_url: string | null;
  draft_status: BillStatus | null;
  draft_notes: string | null;
}): InternalPendingReviewItem {
  const draftAmount = parseDraftAmount(row.draft_amount);
  const draft: PendingReviewDraft | null =
    draftAmount !== null ||
    row.draft_due_date ||
    row.draft_statement_date ||
    row.draft_pay_url ||
    row.draft_notes
      ? {
          amount: draftAmount,
          dueDate: toIsoDate(row.draft_due_date),
          statementDate: toIsoDate(row.draft_statement_date),
          payUrl: row.draft_pay_url,
          status: coerceBillStatus(row.draft_status ?? 'todo'),
          notes: row.draft_notes ?? null
        }
      : null;

  return {
    itemId: row.item_id,
    detectedType: row.detected_type,
    confidence: typeof row.confidence === 'string' ? parseFloat(row.confidence) : row.confidence,
    createdAt: row.created_at,
    recipient: {
      id: row.recipient_id,
      displayName: row.recipient_name
    },
    source: {
      id: row.source_id,
      subject: row.source_subject,
      sender: row.source_sender,
      shortExcerpt: row.source_short_excerpt,
      storageKey: row.source_storage_key
    },
    draft
  };
}

export async function listPendingReviews(user: User): Promise<PendingReviewListResponse> {
  const rows = await listPendingReviewItemsForUser(user.id);
  const items = rows.map(mapPendingRow);
  return {
    items: items.map<PendingReviewItem>((item) => ({
      itemId: item.itemId,
      detectedType: item.detectedType as PendingReviewItem['detectedType'],
      confidence: item.confidence,
      createdAt: item.createdAt.toISOString(),
      recipient: item.recipient,
      source: item.source,
      draft: item.draft
    }))
  };
}

interface ReviewBillInput {
  amount?: number | null;
  dueDate?: string | null;
  statementDate?: string | null;
  payUrl?: string | null;
  status?: BillStatus | null;
  notes?: string | null;
}

function mergeDraft(existing: InternalPendingReviewItem, input: ReviewBillInput): PendingReviewDraft {
  const draft = existing.draft ?? {
    amount: null,
    dueDate: null,
    statementDate: null,
    payUrl: null,
    status: 'todo',
    notes: null
  };

  return {
    amount: input.amount ?? draft.amount,
    dueDate: input.dueDate ?? draft.dueDate,
    statementDate: input.statementDate ?? draft.statementDate,
    payUrl: input.payUrl ?? draft.payUrl,
    status: coerceBillStatus(input.status ?? draft.status),
    notes: input.notes ?? draft.notes
  };
}

function buildBillRequest(draft: PendingReviewDraft): BillCreateRequest {
  if (draft.amount === null || Number.isNaN(draft.amount)) {
    throw new ValidationError({ field: 'amount', message: 'Amount is required to approve a bill.' });
  }

  return {
    amount: draft.amount,
    dueDate: draft.dueDate ?? undefined,
    statementDate: draft.statementDate ?? undefined,
    payUrl: draft.payUrl ?? undefined,
    status: draft.status ?? 'todo'
  };
}

export async function saveBillDraft(
  user: User,
  itemId: number,
  input: ReviewBillInput
): Promise<PendingReviewDraft> {
  const row = await getPendingReviewItemForUser(user.id, itemId);
  if (!row) {
    throw new NotFoundError('Pending review item not found');
  }

  const pending = mapPendingRow(row);
  const merged = mergeDraft(pending, input);

  await upsertBillDraft(itemId, merged);
  const updatedDraft = await getBillDraftByItemId(itemId);

  return {
    amount: parseDraftAmount(updatedDraft?.amount ?? null),
    dueDate: toIsoDate(updatedDraft?.due_date ?? null),
    statementDate: toIsoDate(updatedDraft?.statement_date ?? null),
    payUrl: updatedDraft?.pay_url ?? null,
    status: coerceBillStatus(updatedDraft?.status ?? 'todo'),
    notes: updatedDraft?.notes ?? null
  };
}

export async function approvePendingBill(
  user: User,
  itemId: number,
  input: ReviewBillInput
): Promise<Bill> {
  const row = await getPendingReviewItemForUser(user.id, itemId);
  if (!row) {
    throw new NotFoundError('Pending review item not found');
  }

  const pending = mapPendingRow(row);
  const mergedDraft = mergeDraft(pending, input);
  const billRequest = buildBillRequest(mergedDraft);

  await updateItemReviewStatus(itemId, 'auto');
  const bill = await createBill(itemId, billRequest);
  await deleteBillDraft(itemId);
  await createAuditLog(itemId, 'review_approved', {
    billId: bill.id,
    request: billRequest,
    reviewerId: user.id
  });

  return bill;
}

export async function rejectPendingItem(user: User, itemId: number, reason?: string | null): Promise<void> {
  const row = await getPendingReviewItemForUser(user.id, itemId);
  if (!row) {
    throw new NotFoundError('Pending review item not found');
  }

  await deleteBillDraft(itemId);
  await reclassifyItem(itemId, 'noise');
  await createAuditLog(itemId, 'review_rejected', {
    reason: reason ?? null,
    reviewerId: user.id
  });
}
