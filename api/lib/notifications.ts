import { DateTime } from 'luxon';
import { and, eq, sql } from 'drizzle-orm';

import {
  careRecipientMemberships,
  careRecipients,
  caregivers,
  notificationDeliveries,
  tasks,
} from '../db/schema';
import { dayBoundsUtc } from './timezone';
import { sendPushToCaregiver } from './push';

const DIGEST_HOUR_LOCAL = 8;
const DIGEST_MINUTE_WINDOW = 5;

const withinDigestWindow = (dt: DateTime) => {
  return dt.hour === DIGEST_HOUR_LOCAL && dt.minute < DIGEST_MINUTE_WINDOW;
};

export const runNotificationTick = async ({ db, log }: { db: any; log?: any }) => {
  const now = new Date();

  const memberships = await db
    .select({
      careRecipientId: careRecipientMemberships.careRecipientId,
      caregiverId: careRecipientMemberships.caregiverId,
      role: careRecipientMemberships.role,
      caregiverTimezone: caregivers.timezone,
      hubTimezone: careRecipients.timezone,
    })
    .from(careRecipientMemberships)
    .innerJoin(caregivers, eq(caregivers.id, careRecipientMemberships.caregiverId))
    .innerJoin(careRecipients, eq(careRecipients.id, careRecipientMemberships.careRecipientId));

  // Review digest (hub timezone): owner-only, only if pending review exists.
  const owners = memberships.filter((m: any) => m.role === 'owner');
  for (const owner of owners) {
    const dt = DateTime.fromJSDate(now, { zone: owner.hubTimezone ?? 'UTC' });
    if (!withinDigestWindow(dt)) continue;
    const localDate = dt.toISODate();
    if (!localDate) continue;

    const [pending] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.careRecipientId, owner.careRecipientId),
          eq(tasks.reviewState, 'pending'),
          sql`${tasks.reviewState} != 'ignored'`
        )
      );

    const pendingCount = pending?.count ?? 0;
    if (pendingCount <= 0) continue;

    const [delivery] = await db
      .insert(notificationDeliveries)
      .values({
        caregiverId: owner.caregiverId,
        type: 'review_digest',
        key: localDate,
        sentAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: notificationDeliveries.id });

    if (!delivery) continue;

    await sendPushToCaregiver({
      db,
      caregiverId: owner.caregiverId,
      title: 'Needs review',
      body: `${pendingCount} task${pendingCount === 1 ? '' : 's'} need review`,
      data: { type: 'review_digest', careRecipientId: owner.careRecipientId },
      log,
    });
  }

  // Appointment today (caregiver timezone): all caregivers, only if appointments exist today.
  for (const member of memberships) {
    const tz = member.caregiverTimezone ?? 'UTC';
    const dt = DateTime.fromJSDate(now, { zone: tz });
    if (!withinDigestWindow(dt)) continue;
    const localDate = dt.toISODate();
    if (!localDate) continue;

    const { startUtc, endUtc } = dayBoundsUtc({ timeZone: tz, now });
    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.careRecipientId, member.careRecipientId),
          eq(tasks.type, 'appointment'),
          sql`${tasks.reviewState} != 'ignored'`,
          sql`${tasks.status} != 'done'`,
          sql`${tasks.startAt} >= ${startUtc} AND ${tasks.startAt} < ${endUtc}`
        )
      );
    const apptCount = countRow?.count ?? 0;
    if (apptCount <= 0) continue;

    const [delivery] = await db
      .insert(notificationDeliveries)
      .values({
        caregiverId: member.caregiverId,
        type: 'appointment_today',
        key: localDate,
        sentAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: notificationDeliveries.id });

    if (!delivery) continue;

    await sendPushToCaregiver({
      db,
      caregiverId: member.caregiverId,
      title: 'Appointment today',
      body: `${apptCount} appointment${apptCount === 1 ? '' : 's'} today`,
      data: { type: 'appointment_today', careRecipientId: member.careRecipientId },
      log,
    });
  }
};
