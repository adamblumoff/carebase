import type { Request, Response } from 'express';
import type { MedicationIntakeStatus, User } from '@carebase/shared';
import {
  archiveMedicationForOwner,
  clearMedicationRefillProjection,
  createMedicationDoseForOwner,
  createMedicationForOwner,
  deleteMedicationDoseForOwner,
  deleteMedicationForOwner,
  deleteMedicationIntakeForOwner,
  getMedicationForUser,
  listMedicationsForUser,
  recordMedicationIntake,
  setMedicationRefillProjection,
  updateMedicationDoseForOwner,
  updateMedicationForOwner,
  updateMedicationIntakeStatus,
  unarchiveMedicationForOwner
} from '../../services/medicationService.js';
import {
  medicationCreateSchema,
  medicationDoseCreateSchema,
  medicationDoseParamsSchema,
  medicationDoseUpdateSchema,
  medicationIdParamsSchema,
  medicationIntakeCreateSchema,
  medicationIntakeParamsSchema,
  medicationIntakeStatusSchema,
  medicationListQuerySchema,
  medicationRefillPayloadSchema,
  medicationUpdateSchema
} from '../../validators/medications.ts';
import { UnauthorizedError } from '../../utils/errors.js';
import { route } from '../../utils/httpHandler.js';
import { validateBody, validateParams, validateQuery } from '../../utils/validation.js';

function ensureUser(req: Request): User {
  const user = req.user as User | undefined;
  if (!user) {
    throw new UnauthorizedError();
  }
  return user;
}

type MedicationListQuery = ReturnType<typeof medicationListQuerySchema.parse>;

function buildListOptions(query: MedicationListQuery) {
  const options: Parameters<typeof listMedicationsForUser>[1] = {};
  if (query.includeArchived !== undefined) {
    options.includeArchived = query.includeArchived;
  }
  if (query.intakeLimit !== undefined) {
    options.intakeLimit = query.intakeLimit;
  }
  if (query.intakeLookbackDays !== undefined) {
    options.intakeLookbackDays = query.intakeLookbackDays;
  }
  if (query.statuses !== undefined) {
    options.statuses = query.statuses as MedicationIntakeStatus[];
  }
  return options;
}

export const listMedications = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const query = validateQuery(req, medicationListQuerySchema);
  const results = await listMedicationsForUser(user, buildListOptions(query));
  res.json({ medications: results });
});

export const getMedication = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationIdParamsSchema);
  const query = validateQuery(req, medicationListQuerySchema);
  const medication = await getMedicationForUser(user, params.id, buildListOptions(query));
  res.json(medication);
});

export const createMedication = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const payload = validateBody(req, medicationCreateSchema);
  const medication = await createMedicationForOwner(user, payload);
  res.status(201).json(medication);
});

export const updateMedication = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationIdParamsSchema);
  const payload = validateBody(req, medicationUpdateSchema);
  const medication = await updateMedicationForOwner(user, params.id, payload);
  res.json(medication);
});

export const archiveMedicationHandler = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationIdParamsSchema);
  const medication = await archiveMedicationForOwner(user, params.id);
  res.json(medication);
});

export const unarchiveMedicationHandler = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationIdParamsSchema);
  const medication = await unarchiveMedicationForOwner(user, params.id);
  res.json(medication);
});

export const createDose = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationIdParamsSchema);
  const payload = validateBody(req, medicationDoseCreateSchema);
  const medication = await createMedicationDoseForOwner(user, params.id, payload);
  res.status(201).json(medication);
});

export const updateDose = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationDoseParamsSchema);
  const payload = validateBody(req, medicationDoseUpdateSchema);
  const medication = await updateMedicationDoseForOwner(user, params.id, params.doseId, payload);
  res.json(medication);
});

export const deleteDose = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationDoseParamsSchema);
  const medication = await deleteMedicationDoseForOwner(user, params.id, params.doseId);
  res.json(medication);
});

export const deleteMedication = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationIdParamsSchema);
  const result = await deleteMedicationForOwner(user, params.id);
  res.json(result);
});

export const deleteIntake = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationIntakeParamsSchema);
  const result = await deleteMedicationIntakeForOwner(user, params.id, params.intakeId);
  res.json(result);
});

export const createIntake = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationIdParamsSchema);
  const payload = validateBody(req, medicationIntakeCreateSchema);
  const medication = await recordMedicationIntake(user, params.id, payload);
  res.status(201).json(medication);
});

export const updateIntakeStatus = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationIntakeParamsSchema);
  const { status } = validateBody(req, medicationIntakeStatusSchema);
  const medication = await updateMedicationIntakeStatus(user, params.id, params.intakeId, status);
  res.json(medication);
});

export const setRefillProjection = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationIdParamsSchema);
  const payload = validateBody(req, medicationRefillPayloadSchema);
  const medication = await setMedicationRefillProjection(user, params.id, payload.expectedRunOutOn);
  res.json(medication);
});

export const clearRefillProjection = route(async (req: Request, res: Response) => {
  const user = ensureUser(req);
  const params = validateParams(req, medicationIdParamsSchema);
  const medication = await clearMedicationRefillProjection(user, params.id);
  res.json(medication);
});
