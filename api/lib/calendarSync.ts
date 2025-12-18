import { tasks } from '../db/schema';

export type CalendarListResult = {
  items: any[];
  nextSyncToken: string | null;
  resetSyncToken: boolean;
};

const buildCalendarListRequest = (syncToken?: string | null) => ({
  calendarId: 'primary',
  syncToken: syncToken ?? undefined,
  maxResults: 20,
  singleEvents: true,
  showDeleted: true,
  orderBy: 'updated',
});

const isSyncTokenInvalidError = (err: any) => {
  const code = err?.code ?? err?.response?.status ?? err?.response?.data?.error?.code;
  return code === 410 || code === 404;
};

export const listCalendarEvents = async ({
  calendar,
  syncToken,
}: {
  calendar: { events: { list: (args: any) => Promise<any> } };
  syncToken?: string | null;
}): Promise<CalendarListResult> => {
  try {
    const res = await calendar.events.list(buildCalendarListRequest(syncToken));
    return {
      items: res.data.items ?? [],
      nextSyncToken: res.data.nextSyncToken ?? null,
      resetSyncToken: false,
    };
  } catch (err) {
    if (isSyncTokenInvalidError(err)) {
      const res = await calendar.events.list(buildCalendarListRequest(undefined));
      return {
        items: res.data.items ?? [],
        nextSyncToken: res.data.nextSyncToken ?? null,
        resetSyncToken: true,
      };
    }
    throw err;
  }
};

export const calendarEventToTaskPayload = ({
  event,
  caregiverId,
  careRecipientId,
}: {
  event: any;
  caregiverId: string;
  careRecipientId: string;
}) => {
  const start = event.start?.dateTime ?? event.start?.date ?? null;
  const end = event.end?.dateTime ?? event.end?.date ?? null;
  const externalId = event.iCalUID ?? event.id ?? undefined;
  const payload = {
    title: event.summary ?? 'Appointment',
    type: 'appointment' as const,
    status: 'scheduled' as const,
    reviewState: 'approved' as const,
    provider: 'gmail' as const,
    externalId,
    sourceId: event.id ?? undefined,
    sourceLink: event.htmlLink ?? undefined,
    sender: event.organizer?.email ?? undefined,
    rawSnippet: event.description ?? undefined,
    confidence: 0.9,
    syncedAt: new Date(),
    careRecipientId,
    createdById: caregiverId,
    startAt: start ? new Date(start) : null,
    endAt: end ? new Date(end) : null,
    location: event.location ?? null,
    updatedAt: new Date(),
  } satisfies Partial<typeof tasks.$inferInsert>;

  const isCancelled =
    event.status === 'cancelled' || event.status === 'canceled' || event.cancelled === true;

  return { payload, externalId, isCancelled };
};
