/**
 * Mobile API: Authentication endpoints
 */
import express from 'express';
import {
  getSession,
  postLogout,
  getUser,
  postMobileLogin,
} from '../../controllers/api/auth.js';

const router = express.Router();

router.get('/session', getSession);
router.post('/logout', postLogout);
router.get('/user', getUser);
router.post('/mobile-login', postMobileLogin);

export default router;
