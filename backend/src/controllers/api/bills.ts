import type { Request, Response } from 'express';
import { getBillById, updateBill, deleteBill, updateBillStatus } from '../../db/queries.js';
import type { BillStatus, BillUpdateData, User } from '@carebase/shared';

export async function getBill(req: Request, res: Response): Promise<void> {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { id } = req.params;
    const bill = await getBillById(Number.parseInt(id, 10), user.id);

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
    const { amount, dueDate, statementDate, payUrl, status } = req.body;

    const updateData: BillUpdateData = {};
    if (amount !== undefined && amount !== '') updateData.amount = Number.parseFloat(amount);
    if (dueDate !== undefined) updateData.dueDate = dueDate;
    if (statementDate !== undefined) updateData.statementDate = statementDate;
    if (payUrl !== undefined) updateData.payUrl = payUrl;
    if (status !== undefined) updateData.status = status as BillStatus;

    const updated = await updateBill(Number.parseInt(id, 10), user.id, updateData);

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
    const updated = await updateBillStatus(Number.parseInt(id, 10), user.id, 'paid');

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
