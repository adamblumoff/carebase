/**
 * Mobile API: Appointment CRUD endpoints
 */
import express from 'express';
import {
  getAppointment,
  patchAppointment,
  removeAppointment,
} from '../../controllers/api/appointments.js';

const router = express.Router();

router.get('/:id', getAppointment);
router.patch('/:id', patchAppointment);
router.delete('/:id', removeAppointment);

export default router;
