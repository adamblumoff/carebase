import { DateTime } from 'luxon';
import { and, eq, inArray, sql } from 'drizzle-orm';

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

const timezoneIsInDigestWindow = (timeZone: string, now: Date) => {
  try {
    const dt = DateTime.fromJSDate(now, { zone: timeZone });
    return dt.isValid && withinDigestWindow(dt);
  } catch {
    return false;
  }
};

export const runNotificationTick = async ({ db, log }: { db: any; log?: any }) => {
  const now = new Date();

  const caregiverTimezoneRows = await db
    .selectDistinct({ tz: caregivers.timezone })
    .from(caregivers);
  const hubTimezoneReadyRows = await db
    .selectDistinct({ tz: careRecipients.timezone })
    .from(careRecipients)
    .where(sql`${careRecipients.timezoneSource} != 'unset'`);

  const caregiverTimezonesInWindow = caregiverTimezoneRows
    .map((row: any) => row.tz as string)
    .filter(Boolean)
    .filter((tz: string) => timezoneIsInDigestWindow(tz, now));

  const hubTimezonesReadyInWindow = hubTimezoneReadyRows
    .map((row: any) => row.tz as string)
    .filter(Boolean)
    .filter((tz: string) => timezoneIsInDigestWindow(tz, now));

  if (!caregiverTimezonesInWindow.length && !hubTimezonesReadyInWindow.length) {
    return;
  }

  const membershipSelect = {
    careRecipientId: careRecipientMemberships.careRecipientId,
    caregiverId: careRecipientMemberships.caregiverId,
    role: careRecipientMemberships.role,
    caregiverTimezone: caregivers.timezone,
    hubTimezone: careRecipients.timezone,
  };

  const [ownerMemberships, caregiverMemberships] = await Promise.all([
    hubTimezonesReadyInWindow.length
      ? db
          .select(membershipSelect)
          .from(careRecipientMemberships)
          .innerJoin(caregivers, eq(caregivers.id, careRecipientMemberships.caregiverId))
          .innerJoin(
            careRecipients,
            eq(careRecipients.id, careRecipientMemberships.careRecipientId)
          )
          .where(
            and(
              eq(careRecipientMemberships.role, 'owner'),
              sql`${careRecipients.timezoneSource} != 'unset'`,
              inArray(careRecipients.timezone, hubTimezonesReadyInWindow)
            )
          )
      : Promise.resolve([]),
    caregiverTimezonesInWindow.length
      ? db
          .select(membershipSelect)
          .from(careRecipientMemberships)
          .innerJoin(caregivers, eq(caregivers.id, careRecipientMemberships.caregiverId))
          .innerJoin(
            careRecipients,
            eq(careRecipients.id, careRecipientMemberships.careRecipientId)
          )
          .where(inArray(caregivers.timezone, caregiverTimezonesInWindow))
      : Promise.resolve([]),
  ]);

  // Review digest (hub timezone): owner-only, only if pending review exists.
  const ownersDue = (ownerMemberships as any[])
    .map((owner) => {
      const dt = DateTime.fromJSDate(now, { zone: owner.hubTimezone ?? 'UTC' });
      if (!withinDigestWindow(dt)) return null;
      const localDate = dt.toISODate();
      if (!localDate) return null;
      return {
        caregiverId: owner.caregiverId as string,
        careRecipientId: owner.careRecipientId as string,
        localDate,
      };
    })
    .filter(Boolean) as { caregiverId: string; careRecipientId: string; localDate: string }[];

  if (ownersDue.length) {
    const hubIds = Array.from(new Set(ownersDue.map((o) => o.careRecipientId)));

    const pendingRows = await db
      .select({
        careRecipientId: tasks.careRecipientId,
        count: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .where(and(inArray(tasks.careRecipientId, hubIds), eq(tasks.reviewState, 'pending')))
      .groupBy(tasks.careRecipientId);

    const pendingByHub = new Map<string, number>(
      pendingRows.map((row: any) => [row.careRecipientId, row.count ?? 0])
    );

    for (const owner of ownersDue) {
      const pendingCount = pendingByHub.get(owner.careRecipientId) ?? 0;
      if (pendingCount <= 0) continue;

      const key = `${owner.localDate}:${owner.careRecipientId}`;
      const [delivery] = await db
        .insert(notificationDeliveries)
        .values({
          caregiverId: owner.caregiverId,
          type: 'review_digest',
          key,
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
  }

  // Appointment today (caregiver timezone): all caregivers, only if appointments exist today.
  const membersDueByTimezone = new Map<
    string,
    { caregiverId: string; careRecipientId: string; localDate: string }[]
  >();
  for (const member of caregiverMemberships as any[]) {
    const tz = member.caregiverTimezone ?? 'UTC';
    const dt = DateTime.fromJSDate(now, { zone: tz });
    if (!withinDigestWindow(dt)) continue;
    const localDate = dt.toISODate();
    if (!localDate) continue;

    const entry = {
      caregiverId: member.caregiverId as string,
      careRecipientId: member.careRecipientId as string,
      localDate,
    };
    const list = membersDueByTimezone.get(tz) ?? [];
    list.push(entry);
    membersDueByTimezone.set(tz, list);
  }

  for (const [tz, membersDue] of membersDueByTimezone.entries()) {
    const { startUtc, endUtc } = dayBoundsUtc({ timeZone: tz, now });
    const hubIds = Array.from(new Set(membersDue.map((m) => m.careRecipientId)));

    const countRows = await db
      .select({
        careRecipientId: tasks.careRecipientId,
        count: sql<number>`count(*)::int`,
      })
      .from(tasks)
      .where(
        and(
          inArray(tasks.careRecipientId, hubIds),
          eq(tasks.type, 'appointment'),
          sql`${tasks.reviewState} != 'ignored'`,
          sql`${tasks.status} != 'done'`,
          sql`${tasks.startAt} >= ${startUtc} AND ${tasks.startAt} < ${endUtc}`
        )
      )
      .groupBy(tasks.careRecipientId);

    const apptsByHub = new Map<string, number>(
      countRows.map((row: any) => [row.careRecipientId, row.count ?? 0])
    );

    for (const member of membersDue) {
      const apptCount = apptsByHub.get(member.careRecipientId) ?? 0;
      if (apptCount <= 0) continue;

      const key = `${member.localDate}:${member.careRecipientId}`;
      const [delivery] = await db
        .insert(notificationDeliveries)
        .values({
          caregiverId: member.caregiverId,
          type: 'appointment_today',
          key,
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
  }
};
