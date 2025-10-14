/**
 * Mobile API: Plan endpoints (appointments + bills)
 */
import express from 'express';
import { getPlan, getPlanVersionHandler } from '../../controllers/api/plan.js';

const router = express.Router();

router.get('/', getPlan);
router.get('/version', getPlanVersionHandler);

export default router;
