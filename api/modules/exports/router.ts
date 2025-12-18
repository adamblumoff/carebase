import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import PDFDocument from 'pdfkit';
import { z } from 'zod';

import { careRecipients, handoffNotes, tasks } from '../../db/schema';
import { requireCareRecipientMembership } from '../../lib/careRecipient';
import { getSignedDownloadUrl, uploadBuffer } from '../../lib/s3';
import { authedProcedure, router } from '../../trpc/trpc';

const buildWeeklySummaryPdf = async ({
  careRecipientName,
  hubTimezone,
  tasks,
  notes,
  generatedAt,
}: {
  careRecipientName: string;
  hubTimezone: string;
  tasks: {
    title: string;
    type: string;
    status: string;
    updatedAt: Date;
  }[];
  notes: { localDate: string; body: string }[];
  generatedAt: Date;
}) => {
  const doc = new PDFDocument({ size: 'LETTER', margin: 48 });
  const chunks: Buffer[] = [];

  doc.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));

  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  doc.fontSize(20).text('Weekly Summary', { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`Care recipient: ${careRecipientName}`);
  doc
    .fontSize(12)
    .text(
      `Generated: ${DateTime.fromJSDate(generatedAt, { zone: hubTimezone }).toFormat(
        'LLL d, yyyy t ZZZZ'
      )}`
    );
  doc.moveDown();

  doc.fontSize(14).text('Daily Notes', { underline: true });
  doc.moveDown(0.5);
  if (!notes.length) {
    doc.fontSize(11).text('No notes recorded.');
  } else {
    notes.forEach((note) => {
      doc.fontSize(11).text(`${note.localDate}:`);
      doc.fontSize(11).text(note.body || '—', { indent: 12 });
      doc.moveDown(0.4);
    });
  }

  doc.moveDown();
  doc.fontSize(14).text('Tasks Updated (Last 7 Days)', { underline: true });
  doc.moveDown(0.5);
  if (!tasks.length) {
    doc.fontSize(11).text('No tasks updated in the last 7 days.');
  } else {
    tasks.forEach((task) => {
      const updatedLabel = DateTime.fromJSDate(task.updatedAt, { zone: hubTimezone }).toFormat(
        'LLL d, yyyy t'
      );
      doc.fontSize(11).text(`• ${task.title} (${task.type}, ${task.status})`, { continued: false });
      doc.fontSize(10).text(`Updated: ${updatedLabel}`, { indent: 12 });
    });
  }

  doc.end();
  return done;
};

export const exportsRouter = router({
  weeklySummary: authedProcedure.input(z.object({}).optional()).query(async ({ ctx }) => {
    const membership = await requireCareRecipientMembership(ctx);
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [recipient] = await ctx.db
      .select({
        name: careRecipients.name,
        timezone: careRecipients.timezone,
      })
      .from(careRecipients)
      .where(eq(careRecipients.id, membership.careRecipientId))
      .limit(1);

    const hubTimezone = recipient?.timezone ?? 'UTC';
    const careRecipientName = recipient?.name ?? 'Care Recipient';

    const taskRows = await ctx.db
      .select({
        title: tasks.title,
        type: tasks.type,
        status: tasks.status,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.careRecipientId, membership.careRecipientId),
          gte(tasks.updatedAt, since),
          sql`${tasks.reviewState} != 'ignored'`
        )
      )
      .orderBy(desc(tasks.updatedAt));

    const startLocal = DateTime.fromJSDate(now, { zone: hubTimezone })
      .startOf('day')
      .minus({ days: 6 });
    const dates = Array.from({ length: 7 }, (_, index) =>
      startLocal.plus({ days: index }).toISODate()
    ).filter(Boolean) as string[];

    const notes = dates.length
      ? await ctx.db
          .select({
            localDate: handoffNotes.localDate,
            body: handoffNotes.body,
          })
          .from(handoffNotes)
          .where(
            and(
              eq(handoffNotes.careRecipientId, membership.careRecipientId),
              inArray(handoffNotes.localDate, dates)
            )
          )
          .orderBy(handoffNotes.localDate)
      : [];

    const pdfBuffer = await buildWeeklySummaryPdf({
      careRecipientName,
      hubTimezone,
      tasks: taskRows,
      notes,
      generatedAt: now,
    });

    const storageKey = `exports/${membership.careRecipientId}/weekly-summary-${DateTime.fromJSDate(
      now,
      { zone: hubTimezone }
    ).toFormat('yyyyLLdd')}-${randomUUID()}.pdf`;

    await uploadBuffer({
      key: storageKey,
      body: pdfBuffer,
      contentType: 'application/pdf',
    });

    const { url } = await getSignedDownloadUrl({ key: storageKey, expiresInSeconds: 3600 });

    return {
      url,
      storageKey,
      expiresInSeconds: 3600,
      taskCount: taskRows.length,
    };
  }),
});
