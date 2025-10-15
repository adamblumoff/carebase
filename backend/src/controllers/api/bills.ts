import type { Request, Response } from 'express';
import {
  getBillById,
  getBillByIdForRecipient,
  updateBill,
  updateBillForRecipient,
  deleteBill,
  updateBillStatus,
  updateBillStatusForRecipient,
  findCollaboratorForRecipient,
  resolveRecipientContextForUser,
} from '../../db/queries.js';
import type { BillStatus, BillUpdateData, User } from '@carebase/shared';

export async function getBill(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const context = await resolveRecipientContextForUser(user);
    if (!context) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }

    const billId = Number.parseInt(id, 10);
    const bill =
      context.role === 'owner'
        ? await getBillById(billId, user.id)
        : await getBillByIdForRecipient(billId, context.recipient.id);

    if (!bill) {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }

    res.json(bill);
  } catch (error) {
    console.error('Get bill error:', error);
    res.status(500).json({ error: 'Failed to fetch bill' });
  }
}

export async function patchBill(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const context = await resolveRecipientContextForUser(user);
    if (!context) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }

    const billId = Number.parseInt(id, 10);

    if (context.role === 'owner') {
      const existing = await getBillById(billId, user.id);
      if (!existing) {
        res.status(404).json({ error: 'Bill not found' });
        return;
      }

      const { amount, dueDate, statementDate, payUrl, status, assignedCollaboratorId } = req.body;

      const updateData: BillUpdateData = {};
      if (amount !== undefined && amount !== '') updateData.amount = Number.parseFloat(amount);
      if (dueDate !== undefined) updateData.dueDate = dueDate;
      if (statementDate !== undefined) updateData.statementDate = statementDate;
      if (payUrl !== undefined) updateData.payUrl = payUrl;
      if (status !== undefined) updateData.status = status as BillStatus;

      if (assignedCollaboratorId !== undefined) {
        if (assignedCollaboratorId === null || assignedCollaboratorId === '') {
          updateData.assignedCollaboratorId = null;
        } else {
          const collaboratorId = Number.parseInt(String(assignedCollaboratorId), 10);
          if (Number.isNaN(collaboratorId)) {
            res.status(400).json({ error: 'Invalid collaborator id' });
            return;
          }
          const collaborator = await findCollaboratorForRecipient(context.recipient.id, collaboratorId);
          if (!collaborator) {
            res.status(404).json({ error: 'Collaborator not found' });
            return;
          }
          updateData.assignedCollaboratorId = collaborator.id;
        }
      }

      const updated = await updateBill(billId, user.id, {
        statementDate:
          updateData.statementDate ?? (existing.statementDate ? existing.statementDate.toISOString().split('T')[0] : undefined),
        amount: updateData.amount ?? existing.amount ?? undefined,
        dueDate:
          updateData.dueDate ?? (existing.dueDate ? existing.dueDate.toISOString().split('T')[0] : undefined),
        payUrl: updateData.payUrl ?? existing.payUrl ?? undefined,
        status: updateData.status ?? existing.status,
        assignedCollaboratorId:
          updateData.assignedCollaboratorId ?? existing.assignedCollaboratorId ?? null,
      });
      res.json(updated);
      return;
    }

    const existing = await getBillByIdForRecipient(billId, context.recipient.id);
    if (!existing) {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }

    const { status } = req.body as { status?: BillStatus };
    if (!status) {
      res.status(403).json({ error: 'Contributors can only update status' });
      return;
    }

    const allowedStatuses: BillStatus[] = ['todo', 'paid', 'overdue'];
    if (!allowedStatuses.includes(status)) {
      res.status(400).json({ error: 'Invalid status value' });
      return;
    }

    const updated = await updateBillForRecipient(billId, context.recipient.id, {
      statementDate: existing.statementDate ? existing.statementDate.toISOString().split('T')[0] : undefined,
      amount: existing.amount ?? undefined,
      dueDate: existing.dueDate ? existing.dueDate.toISOString().split('T')[0] : undefined,
      payUrl: existing.payUrl ?? undefined,
      status,
      assignedCollaboratorId: existing.assignedCollaboratorId ?? null,
    });

    res.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === 'Bill not found') {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }
    console.error('Update bill error:', error);
    res.status(500).json({ error: 'Failed to update bill' });
  }
}

export async function removeBill(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const context = await resolveRecipientContextForUser(user);
    if (!context) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }

    if (context.role !== 'owner') {
      res.status(403).json({ error: 'Only the owner can delete bills' });
      return;
    }

    await deleteBill(Number.parseInt(id, 10), user.id);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Bill not found') {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }
    console.error('Delete bill error:', error);
    res.status(500).json({ error: 'Failed to delete bill' });
  }
}

export async function markBillPaid(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const context = await resolveRecipientContextForUser(user);
    if (!context) {
      res.status(404).json({ error: 'No recipient found' });
      return;
    }

    const billId = Number.parseInt(id, 10);
    const updated =
      context.role === 'owner'
        ? await updateBillStatus(billId, user.id, 'paid')
        : await updateBillStatusForRecipient(billId, context.recipient.id, 'paid');

    res.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === 'Bill not found') {
      res.status(404).json({ error: 'Bill not found' });
      return;
    }
    console.error('Mark bill paid error:', error);
    res.status(500).json({ error: 'Failed to mark bill as paid' });
  }
}
