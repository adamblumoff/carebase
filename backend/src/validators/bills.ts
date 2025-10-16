import { z } from 'zod';

export const billIdParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

export const billOwnerUpdateSchema = z.object({
  amount: z.coerce.number().nonnegative().optional(),
  dueDate: z.string().optional(),
  statementDate: z.string().optional(),
  payUrl: z.string().url().nullable().optional(),
  status: z.enum(['todo', 'paid', 'overdue']).optional(),
  assignedCollaboratorId: z.union([z.coerce.number().int().positive(), z.null(), z.literal('')]).optional()
});

export const billContributorUpdateSchema = z.object({
  status: z.enum(['todo', 'paid', 'overdue'])
});
