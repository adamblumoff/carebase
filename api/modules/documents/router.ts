import { TRPCError } from '@trpc/server';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import { documentTasks, documents, tasks } from '../../db/schema';
import { enqueueBackgroundTask } from '../../lib/asyncTasks';
import { requireCareRecipientMembership, requireOwnerRole } from '../../lib/careRecipient';
import { processDocument } from '../../lib/documentProcessing';
import { createStorageKey, deleteObject, getSignedUploadUrl } from '../../lib/s3';
import { authedProcedure, router } from '../../trpc/trpc';

const uploadInput = z.object({
  filename: z.string().min(1).max(200),
  mimeType: z.string().min(1).max(128),
  sizeBytes: z
    .number()
    .int()
    .min(1)
    .max(50 * 1024 * 1024),
});

export const documentsRouter = router({
  list: authedProcedure.query(async ({ ctx }) => {
    const membership = await requireCareRecipientMembership(ctx);

    return ctx.db
      .select({
        id: documents.id,
        filename: documents.filename,
        mimeType: documents.mimeType,
        sizeBytes: documents.sizeBytes,
        storageKey: documents.storageKey,
        pageCount: documents.pageCount,
        status: documents.status,
        errorMessage: documents.errorMessage,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        uploadedByCaregiverId: documents.uploadedByCaregiverId,
      })
      .from(documents)
      .where(eq(documents.careRecipientId, membership.careRecipientId))
      .orderBy(desc(documents.createdAt));
  }),

  createUploadUrl: authedProcedure.input(uploadInput).mutation(async ({ ctx, input }) => {
    const membership = await requireOwnerRole(ctx);
    const storageKey = createStorageKey({
      careRecipientId: membership.careRecipientId,
      fileName: input.filename,
    });

    const { url } = await getSignedUploadUrl({
      key: storageKey,
      contentType: input.mimeType,
    });

    return {
      uploadUrl: url,
      storageKey,
    };
  }),

  confirmUpload: authedProcedure
    .input(uploadInput.extend({ storageKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);
      const now = new Date();

      if (!input.storageKey.startsWith(membership.careRecipientId)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid storage key' });
      }

      const [created] = await ctx.db
        .insert(documents)
        .values({
          careRecipientId: membership.careRecipientId,
          uploadedByCaregiverId: membership.caregiverId,
          filename: input.filename.trim(),
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          storageKey: input.storageKey,
          status: 'uploaded',
          createdAt: now,
          updatedAt: now,
        })
        .returning({
          id: documents.id,
          filename: documents.filename,
          status: documents.status,
          createdAt: documents.createdAt,
        });

      if (!created) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Upload not recorded' });
      }

      enqueueBackgroundTask({
        label: `process-document:${created.id}`,
        run: async () => {
          await processDocument({ db: ctx.db, documentId: created.id });
        },
      });

      return created;
    }),

  delete: authedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOwnerRole(ctx);

      const [doc] = await ctx.db
        .select({
          id: documents.id,
          storageKey: documents.storageKey,
        })
        .from(documents)
        .where(
          and(eq(documents.id, input.id), eq(documents.careRecipientId, membership.careRecipientId))
        )
        .limit(1);

      if (!doc) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Document not found' });
      }

      await deleteObject({ key: doc.storageKey });

      await ctx.db.transaction(async (tx) => {
        const linkedTasks = await tx
          .select({ taskId: documentTasks.taskId })
          .from(documentTasks)
          .where(eq(documentTasks.documentId, doc.id));

        const taskIds = linkedTasks.map((row) => row.taskId);

        if (taskIds.length) {
          await tx
            .delete(tasks)
            .where(
              and(
                eq(tasks.careRecipientId, membership.careRecipientId),
                inArray(tasks.id, taskIds)
              )
            );
        }

        await tx.delete(documentTasks).where(eq(documentTasks.documentId, doc.id));

        await tx
          .delete(documents)
          .where(
            and(
              eq(documents.id, input.id),
              eq(documents.careRecipientId, membership.careRecipientId)
            )
          );
      });

      return { id: doc.id };
    }),
});
