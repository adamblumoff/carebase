import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { careProfileBasics, careProfileContacts, careRecipients } from '../../db/schema';
import { requireCareRecipientMembership, requireOwnerRole } from '../../lib/careRecipient';
import { authedProcedure, router } from '../../trpc/trpc';

const dobSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional();

const toDate = (value?: string) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const serializeDob = (value?: Date | null) =>
  value ? value.toISOString().slice(0, 10) : null;

export const careProfileRouter = router({
  get: authedProcedure.query(async ({ ctx }) => {
    const membership = await requireCareRecipientMembership(ctx);

    const [recipient] = await ctx.db
      .select({ name: careRecipients.name })
      .from(careRecipients)
      .where(eq(careRecipients.id, membership.careRecipientId))
      .limit(1);

    const [basics] = await ctx.db
      .select({
        id: careProfileBasics.id,
        fullName: careProfileBasics.fullName,
        dob: careProfileBasics.dob,
        notes: careProfileBasics.notes,
        updatedAt: careProfileBasics.updatedAt,
        updatedByCaregiverId: careProfileBasics.updatedByCaregiverId,
      })
      .from(careProfileBasics)
      .where(eq(careProfileBasics.careRecipientId, membership.careRecipientId))
      .limit(1);

    const contacts = await ctx.db
      .select({
        id: careProfileContacts.id,
        name: careProfileContacts.name,
        relationship: careProfileContacts.relationship,
        phone: careProfileContacts.phone,
        email: careProfileContacts.email,
        address: careProfileContacts.address,
        isEmergency: careProfileContacts.isEmergency,
        updatedAt: careProfileContacts.updatedAt,
      })
      .from(careProfileContacts)
      .where(eq(careProfileContacts.careRecipientId, membership.careRecipientId))
      .orderBy(careProfileContacts.name);

    return {
      careRecipientName: recipient?.name ?? null,
      basics: basics
        ? {
            ...basics,
            dob: serializeDob(basics.dob ?? null),
          }
        : null,
      contacts,
    };
  }),

  upsertBasics: authedProcedure
    .input(
      z.object({
        fullName: z.string().min(1).max(120),
        dob: dobSchema,
        notes: z.string().max(2000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);
      const now = new Date();
      const dob = toDate(input.dob);

      const [saved] = await ctx.db
        .insert(careProfileBasics)
        .values({
          careRecipientId: membership.careRecipientId,
          fullName: input.fullName.trim(),
          dob,
          notes: input.notes?.trim() ?? null,
          updatedByCaregiverId: membership.caregiverId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [careProfileBasics.careRecipientId],
          set: {
            fullName: input.fullName.trim(),
            dob,
            notes: input.notes?.trim() ?? null,
            updatedByCaregiverId: membership.caregiverId,
            updatedAt: now,
          },
        })
        .returning({
          id: careProfileBasics.id,
          fullName: careProfileBasics.fullName,
          dob: careProfileBasics.dob,
          notes: careProfileBasics.notes,
          updatedAt: careProfileBasics.updatedAt,
          updatedByCaregiverId: careProfileBasics.updatedByCaregiverId,
        });

      if (!saved) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Save failed' });
      }

      return {
        ...saved,
        dob: serializeDob(saved.dob ?? null),
      };
    }),

  upsertContact: authedProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(120),
        relationship: z.string().max(120).optional(),
        phone: z.string().max(40).optional(),
        email: z.string().email().optional(),
        address: z.string().max(300).optional(),
        isEmergency: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);
      const now = new Date();
      const payload = {
        name: input.name.trim(),
        relationship: input.relationship?.trim() ?? null,
        phone: input.phone?.trim() ?? null,
        email: input.email?.trim() ?? null,
        address: input.address?.trim() ?? null,
        isEmergency: input.isEmergency ?? false,
        updatedByCaregiverId: membership.caregiverId,
        updatedAt: now,
      };

      if (input.id) {
        const [updated] = await ctx.db
          .update(careProfileContacts)
          .set(payload)
          .where(
            and(
              eq(careProfileContacts.id, input.id),
              eq(careProfileContacts.careRecipientId, membership.careRecipientId)
            )
          )
          .returning({
            id: careProfileContacts.id,
            name: careProfileContacts.name,
            relationship: careProfileContacts.relationship,
            phone: careProfileContacts.phone,
            email: careProfileContacts.email,
            address: careProfileContacts.address,
            isEmergency: careProfileContacts.isEmergency,
            updatedAt: careProfileContacts.updatedAt,
          });

        if (!updated) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
        }

        return updated;
      }

      const [created] = await ctx.db
        .insert(careProfileContacts)
        .values({
          careRecipientId: membership.careRecipientId,
          createdAt: now,
          ...payload,
        })
        .returning({
          id: careProfileContacts.id,
          name: careProfileContacts.name,
          relationship: careProfileContacts.relationship,
          phone: careProfileContacts.phone,
          email: careProfileContacts.email,
          address: careProfileContacts.address,
          isEmergency: careProfileContacts.isEmergency,
          updatedAt: careProfileContacts.updatedAt,
        });

      if (!created) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Create failed' });
      }

      return created;
    }),

  deleteContact: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);

      const [deleted] = await ctx.db
        .delete(careProfileContacts)
        .where(
          and(
            eq(careProfileContacts.id, input.id),
            eq(careProfileContacts.careRecipientId, membership.careRecipientId)
          )
        )
        .returning({ id: careProfileContacts.id });

      if (!deleted) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Contact not found' });
      }

      return { id: deleted.id };
    }),
});
