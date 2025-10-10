import express from 'express';
import { findAppointmentByIcsToken } from '../db/queries.js';
import { generateICS } from '../services/ics.js';

const router = express.Router();

/**
 * Serve ICS file by token
 * GET /calendar/:token.ics
 */
router.get('/:token.ics', async (req, res) => {
  try {
    const { token } = req.params;

    const appointment = await findAppointmentByIcsToken(token);

    if (!appointment) {
      return res.status(404).send('Appointment not found');
    }

    const icsContent = generateICS(appointment);

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="appointment-${token}.ics"`);
    res.send(icsContent);
  } catch (error) {
    console.error('ICS generation error:', error);
    res.status(500).send('Error generating calendar file');
  }
});

export default router;
