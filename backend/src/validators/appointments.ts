import { z } from 'zod';

export const appointmentIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const appointmentOwnerUpdateSchema = z.object({
  summary: z.string().min(1).max(255).optional(),
  startLocal: z.string().optional(),
  endLocal: z.string().optional(),
  location: z.string().max(255).nullable().optional(),
  prepNote: z.string().max(2000).nullable().optional(),
  assignedCollaboratorId: z.union([z.coerce.number().int().positive(), z.null(), z.literal('')]).optional()
});

export const appointmentContributorUpdateSchema = z.object({
  prepNote: z.string().max(2000)
});
