/**
 * Mobile API: Bill CRUD endpoints
 */
import express, { Request, Response } from 'express';
import {
  getBillById,
  updateBill,
  deleteBill
} from '../../db/queries.js';
import type { BillUpdateData, BillStatus, User } from '@carebase/shared';

const router = express.Router();

/**
 * GET /api/bills/:id
 * Get a specific bill
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const bill = await getBillById(parseInt(id), user.id);

    if (!bill) {
      return res.status(404).json({ error: 'Bill not found' });
    }

    res.json(bill);
  } catch (error) {
    console.error('Get bill error:', error);
    res.status(500).json({ error: 'Failed to fetch bill' });
  }
});

/**
 * PATCH /api/bills/:id
 * Update a bill
 */
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const { amount, dueDate, statementDate, payUrl, status } = req.body;

    const updateData: BillUpdateData = {};
    if (amount !== undefined && amount !== '') updateData.amount = parseFloat(amount);
    if (dueDate !== undefined) updateData.dueDate = dueDate;
    if (statementDate !== undefined) updateData.statementDate = statementDate;
    if (payUrl !== undefined) updateData.payUrl = payUrl;
    if (status !== undefined) updateData.status = status as BillStatus;

    const updated = await updateBill(parseInt(id), user.id, updateData);

    res.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === 'Bill not found') {
      return res.status(404).json({ error: 'Bill not found' });
    }
    console.error('Update bill error:', error);
    res.status(500).json({ error: 'Failed to update bill' });
  }
});

/**
 * DELETE /api/bills/:id
 * Delete a bill
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    await deleteBill(parseInt(id), user.id);

    res.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'Bill not found') {
      return res.status(404).json({ error: 'Bill not found' });
    }
    console.error('Delete bill error:', error);
    res.status(500).json({ error: 'Failed to delete bill' });
  }
});

/**
 * POST /api/bills/:id/mark-paid
 * Mark a bill as paid
 */
router.post('/:id/mark-paid', async (req: Request, res: Response) => {
  try {
    const user = req.user as User | undefined;
    if (!user) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { id } = req.params;
    const updated = await updateBill(parseInt(id), user.id, { status: 'paid' });

    res.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === 'Bill not found') {
      return res.status(404).json({ error: 'Bill not found' });
    }
    console.error('Mark bill paid error:', error);
    res.status(500).json({ error: 'Failed to mark bill as paid' });
  }
});

export default router;
