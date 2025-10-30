import { z } from 'zod';

const positiveId = z.coerce.number().int().positive();

const optionalIsoDate = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Invalid date' });

const optionalIsoDateTime = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Invalid datetime' });

const booleanLike = z
  .union([z.string(), z.boolean()])
  .transform((value) => {
    if (typeof value === 'boolean') return value;
    const normalized = value.toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new Error('Invalid boolean');
  });

const numericLike = z
  .union([z.string(), z.number()])
  .transform((value) => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      throw new Error('Invalid number');
    }
    return parsed;
  });

const statusesLike = z
  .union([z.string(), z.array(z.string())])
  .transform((value) => {
    const values = Array.isArray(value) ? value : value.split(',');
    return values.map((item) => item.trim()).filter((item) => item.length > 0);
  });

export const medicationListQuerySchema = z.object({
  includeArchived: booleanLike.optional(),
  intakeLimit: numericLike.optional(),
  intakeLookbackDays: numericLike.optional(),
  statuses: statusesLike.optional()
});

export const medicationIdParamsSchema = z.object({
  id: positiveId
});

export const medicationDoseParamsSchema = medicationIdParamsSchema.extend({
  doseId: positiveId
});

export const medicationIntakeParamsSchema = medicationIdParamsSchema.extend({
  intakeId: positiveId
});

const nullableNumber = z.union([z.number(), z.null()]);
const nullableString = z.union([z.string(), z.null()]);

const medicationDoseSchema = z.object({
  label: nullableString.optional(),
  timeOfDay: z.string().min(1),
  timezone: z.string().min(1),
  reminderWindowMinutes: z.number().int().positive().optional(),
  isActive: z.boolean().optional()
});

export const medicationCreateSchema = z.object({
  recipientId: positiveId,
  name: z.string().min(1),
  strengthValue: nullableNumber.optional(),
  strengthUnit: nullableString.optional(),
  form: nullableString.optional(),
  instructions: nullableString.optional(),
  notes: nullableString.optional(),
  prescribingProvider: nullableString.optional(),
  startDate: nullableString.optional(),
  endDate: nullableString.optional(),
  quantityOnHand: nullableNumber.optional(),
  refillThreshold: nullableNumber.optional(),
  preferredPharmacy: nullableString.optional(),
  doses: z.array(medicationDoseSchema).optional()
});

export const medicationUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  strengthValue: nullableNumber.optional(),
  strengthUnit: nullableString.optional(),
  form: nullableString.optional(),
  instructions: nullableString.optional(),
  notes: nullableString.optional(),
  prescribingProvider: nullableString.optional(),
  startDate: nullableString.optional(),
  endDate: nullableString.optional(),
  quantityOnHand: nullableNumber.optional(),
  refillThreshold: nullableNumber.optional(),
  preferredPharmacy: nullableString.optional()
});

export const medicationDoseCreateSchema = medicationDoseSchema;

export const medicationDoseUpdateSchema = z.object({
  label: nullableString.optional(),
  timeOfDay: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  reminderWindowMinutes: z.number().int().positive().optional(),
  isActive: z.boolean().optional()
});

export const medicationIntakeCreateSchema = z.object({
  doseId: z.union([positiveId, z.null()]).optional(),
  scheduledFor: optionalIsoDateTime,
  status: z.enum(['pending', 'taken', 'skipped', 'expired'])
});

export const medicationIntakeStatusSchema = z.object({
  status: z.enum(['pending', 'taken', 'skipped', 'expired'])
});

export const medicationRefillPayloadSchema = z.object({
  expectedRunOutOn: z.union([optionalIsoDate, z.null()])
});
