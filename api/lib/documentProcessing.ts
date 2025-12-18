import { GoogleAuth } from 'google-auth-library';
import { eq } from 'drizzle-orm';

import type { DbClient } from '../db/client';
import { documentTasks, documents, tasks } from '../db/schema';
import { getObjectBuffer } from './s3';
import { recordTaskEvent } from './taskEvents';

const MAX_OCR_BYTES = 7_000_000;

const visionAuth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

const extractTextWithVision = async (buffer: Buffer) => {
  if (buffer.length > MAX_OCR_BYTES) return null;
  const client = await visionAuth.getClient();
  const response = await client.request<{ responses?: any[] }>({
    url: 'https://vision.googleapis.com/v1/images:annotate',
    method: 'POST',
    data: {
      requests: [
        {
          image: { content: buffer.toString('base64') },
          features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
        },
      ],
    },
  });

  const annotation = response.data.responses?.[0];
  if (!annotation) return null;
  return (
    annotation.fullTextAnnotation?.text ?? annotation.textAnnotations?.[0]?.description ?? null
  );
};

const classifyDocumentText = ({ text, filename }: { text: string | null; filename: string }) => {
  if (!text) {
    return {
      type: 'general' as const,
      title: `Review document: ${filename}`,
      description: null,
    };
  }

  const normalized = text.toLowerCase();
  let type: 'appointment' | 'bill' | 'medication' | 'general' = 'general';
  if (/(appointment|visit|clinic|doctor|follow[- ]?up)/.test(normalized)) {
    type = 'appointment';
  } else if (/(invoice|statement|amount due|payment due|balance due|bill)/.test(normalized)) {
    type = 'bill';
  } else if (/(prescription|medication|rx|pharmacy|refill)/.test(normalized)) {
    type = 'medication';
  }

  const title =
    type === 'appointment'
      ? 'Appointment from document'
      : type === 'bill'
        ? 'Bill from document'
        : type === 'medication'
          ? 'Medication task from document'
          : `Review document: ${filename}`;

  const description = text.slice(0, 2000);

  return { type, title, description };
};

export const processDocument = async ({ db, documentId }: { db: DbClient; documentId: string }) => {
  const [doc] = await db
    .select({
      id: documents.id,
      careRecipientId: documents.careRecipientId,
      uploadedByCaregiverId: documents.uploadedByCaregiverId,
      filename: documents.filename,
      mimeType: documents.mimeType,
      storageKey: documents.storageKey,
      status: documents.status,
    })
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);

  if (!doc) return;
  if (doc.status === 'ready') return;

  const [existingLink] = await db
    .select({ id: documentTasks.id })
    .from(documentTasks)
    .where(eq(documentTasks.documentId, doc.id))
    .limit(1);

  if (existingLink) {
    await db
      .update(documents)
      .set({ status: 'ready', errorMessage: null, updatedAt: new Date() })
      .where(eq(documents.id, doc.id));
    return;
  }

  const now = new Date();
  await db
    .update(documents)
    .set({ status: 'processing', errorMessage: null, updatedAt: now })
    .where(eq(documents.id, doc.id));

  try {
    const buffer = await getObjectBuffer({ key: doc.storageKey });
    if (!buffer) {
      throw new Error('Document file not found');
    }
    const text = await extractTextWithVision(buffer);
    const { type, title, description } = classifyDocumentText({
      text,
      filename: doc.filename,
    });

    const [task] = await db
      .insert(tasks)
      .values({
        title,
        description,
        type,
        status: 'todo',
        reviewState: 'approved',
        rawSnippet: text ? text.slice(0, 4000) : null,
        careRecipientId: doc.careRecipientId,
        createdById: doc.uploadedByCaregiverId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!task) {
      throw new Error('Failed to create task from document');
    }

    await db
      .insert(documentTasks)
      .values({ documentId: doc.id, taskId: task.id, createdAt: now })
      .onConflictDoNothing();

    await recordTaskEvent({
      db,
      taskId: task.id,
      careRecipientId: doc.careRecipientId,
      actorCaregiverId: doc.uploadedByCaregiverId,
      type: 'created',
      payload: {
        source: 'document',
        documentId: doc.id,
        extractedType: type,
      },
    });

    await db
      .update(documents)
      .set({ status: 'ready', errorMessage: null, updatedAt: new Date() })
      .where(eq(documents.id, doc.id));
  } catch (error: any) {
    await db
      .update(documents)
      .set({
        status: 'error',
        errorMessage: error?.message ?? 'Document processing failed',
        updatedAt: new Date(),
      })
      .where(eq(documents.id, doc.id));
  }
};
