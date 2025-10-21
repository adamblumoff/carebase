import express from 'express';
import { getPendingReviewsHandler, updatePendingReviewHandler } from '../../controllers/api/review.js';

const router = express.Router();

router.get('/pending', getPendingReviewsHandler);
router.patch('/:itemId', updatePendingReviewHandler);

export default router;
