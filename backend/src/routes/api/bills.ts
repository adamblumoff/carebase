/**
 * Mobile API: Bill CRUD endpoints
 */
import express from 'express';
import { getBill, patchBill, removeBill, markBillPaid } from '../../controllers/api/bills.js';

const router = express.Router();

router.get('/:id', getBill);
router.patch('/:id', patchBill);
router.delete('/:id', removeBill);
router.post('/:id/mark-paid', markBillPaid);

export default router;
