import type { Bill, BillStatus, BillUpdateData, User } from '@carebase/shared';
import {
  deleteBill,
  findCollaboratorForRecipient,
  getBillById,
  getBillByIdForRecipient,
  markGoogleSyncPending,
  resolveRecipientContextForUser,
  updateBill,
  updateBillForRecipient,
  updateBillStatus,
  updateBillStatusForRecipient
} from '../db/queries.js';
import { formatDateOnly } from '../utils/dateFormatting.js';
import { ForbiddenError, NotFoundError } from '../utils/errors.js';

interface BillContext {
  recipientId: number;
  role: 'owner' | 'collaborator';
}

async function resolveContext(user: User): Promise<BillContext> {
  const context = await resolveRecipientContextForUser(user.id);
  if (!context || !context.recipient) {
    throw new NotFoundError('No recipient found');
  }

  if (!context.collaborator) {
    return { recipientId: context.recipient.id, role: 'owner' };
  }

  return { recipientId: context.recipient.id, role: 'collaborator' };
}

function normalizeAmount(value: unknown, fallback: number | null): number | undefined {
  if (value === undefined || value === null || value === '') {
    return fallback ?? undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(parsed)) {
    throw new ForbiddenError('Invalid amount');
  }
  return parsed;
}

function normalizeDate(value: unknown, fallback: Date | null): string | undefined {
  if (value === undefined || value === null || value === '') {
    return fallback ? formatDateOnly(fallback instanceof Date ? fallback : new Date(fallback)) : undefined;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ForbiddenError('Invalid date');
  }
  return formatDateOnly(date);
}

function normalizeStatus(value: unknown, fallback: BillStatus): BillStatus {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const allowed: BillStatus[] = ['todo', 'paid', 'overdue'];
  if (allowed.includes(value as BillStatus)) {
    return value as BillStatus;
  }
  throw new ForbiddenError('Invalid status value');
}

async function resolveAssignedCollaborator(
  recipientId: number,
  assignedCollaboratorId: unknown,
  fallback: number | null
): Promise<number | null> {
  if (assignedCollaboratorId === undefined) {
    return fallback;
  }
  if (assignedCollaboratorId === null || assignedCollaboratorId === '') {
    return null;
  }
  const collaboratorId = Number(assignedCollaboratorId);
  if (!Number.isFinite(collaboratorId) || collaboratorId <= 0) {
    throw new ForbiddenError('Invalid collaborator id');
  }
  const collaborator = await findCollaboratorForRecipient(recipientId, collaboratorId);
  if (!collaborator) {
    throw new NotFoundError('Collaborator not found');
  }
  return collaborator.id;
}

export async function fetchBillForUser(user: User, billId: number): Promise<Bill> {
  const { recipientId, role } = await resolveContext(user);
  const bill =
    role === 'owner'
      ? await getBillById(billId, user.id)
      : await getBillByIdForRecipient(billId, recipientId);
  if (!bill) {
    throw new NotFoundError('Bill not found');
  }
  return bill;
}

export async function updateBillAsOwner(
  user: User,
  billId: number,
  updates: BillUpdateData & { assignedCollaboratorId?: number | null | '' }
): Promise<Bill> {
  const bill = await getBillById(billId, user.id);
  if (!bill) {
    throw new NotFoundError('Bill not found');
  }
  const context = await resolveContext(user);

  const normalized: BillUpdateData = {
    amount: normalizeAmount(updates.amount, bill.amount),
    dueDate: normalizeDate(updates.dueDate, bill.dueDate ?? null),
    statementDate: normalizeDate(updates.statementDate, bill.statementDate ?? null),
    payUrl: updates.payUrl === undefined ? bill.payUrl ?? undefined : updates.payUrl ?? undefined,
    status: normalizeStatus(updates.status, bill.status),
    assignedCollaboratorId: await resolveAssignedCollaborator(
      context.recipientId,
      updates.assignedCollaboratorId,
      bill.assignedCollaboratorId
    )
  };

  const updated = await updateBill(billId, user.id, normalized);
  await markGoogleSyncPending(updated.itemId);
  return updated;
}

export async function updateBillAsCollaborator(
  user: User,
  billId: number,
  status: BillStatus
): Promise<Bill> {
  const context = await resolveContext(user);
  if (context.role !== 'collaborator') {
    throw new ForbiddenError('Only collaborators can use this endpoint');
  }

  const existing = await getBillByIdForRecipient(billId, context.recipientId);
  if (!existing) {
    throw new NotFoundError('Bill not found');
  }

  const updated = await updateBillForRecipient(billId, context.recipientId, {
    statementDate: existing.statementDate ? formatDateOnly(existing.statementDate) : undefined,
    amount: existing.amount ?? undefined,
    dueDate: existing.dueDate ? formatDateOnly(existing.dueDate) : undefined,
    payUrl: existing.payUrl ?? undefined,
    status,
    assignedCollaboratorId: existing.assignedCollaboratorId ?? null
  });

  await markGoogleSyncPending(updated.itemId);
  return updated;
}

export async function deleteBillAsOwner(user: User, billId: number): Promise<void> {
  const context = await resolveContext(user);
  if (context.role !== 'owner') {
    throw new ForbiddenError('Only the owner can delete bills');
  }
  const bill = await getBillById(billId, user.id);
  if (!bill) {
    throw new NotFoundError('Bill not found');
  }

  await markGoogleSyncPending(bill.itemId);
  await deleteBill(billId, user.id);
}

export async function markBillPaid(user: User, billId: number): Promise<Bill> {
  const { recipientId, role } = await resolveContext(user);
  const updated =
    role === 'owner'
      ? await updateBillStatus(billId, user.id, 'paid')
      : await updateBillStatusForRecipient(billId, recipientId, 'paid');
  await markGoogleSyncPending(updated.itemId);
  return updated;
}

export async function getBillContext(user: User): Promise<BillContext> {
  return resolveContext(user);
}
