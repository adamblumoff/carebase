/**
 * Mobile API: Authentication endpoints
 */
import express from 'express';
import {
  getSession,
  postLogout,
  getUser,
} from '../../controllers/api/auth.js';

const router = express.Router();

router.get('/session', getSession);
router.post('/logout', postLogout);
router.get('/user', getUser);
export default router;
