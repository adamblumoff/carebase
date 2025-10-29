import express from 'express';
import {
  archiveMedicationHandler,
  clearRefillProjection,
  createDose,
  createIntake,
  createMedication,
  deleteDose,
  getMedication,
  listMedications,
  setRefillProjection,
  unarchiveMedicationHandler,
  updateDose,
  updateIntakeStatus,
  updateMedication
} from '../../controllers/api/medications.js';

const router = express.Router();

router.get('/', listMedications);
router.get('/:id', getMedication);
router.post('/', createMedication);
router.patch('/:id', updateMedication);
router.patch('/:id/archive', archiveMedicationHandler);
router.patch('/:id/unarchive', unarchiveMedicationHandler);

router.post('/:id/doses', createDose);
router.patch('/:id/doses/:doseId', updateDose);
router.delete('/:id/doses/:doseId', deleteDose);

router.post('/:id/intakes', createIntake);
router.patch('/:id/intakes/:intakeId', updateIntakeStatus);

router.post('/:id/refill', setRefillProjection);
router.delete('/:id/refill', clearRefillProjection);

export default router;
