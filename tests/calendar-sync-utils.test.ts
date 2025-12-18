import { calendarEventToTaskPayload, listCalendarEvents } from '../api/lib/calendarSync';

describe('calendar sync helpers', () => {
  test('calendar list includes deleted events', async () => {
    const list = jest.fn(async (args: any) => ({ data: { items: [], nextSyncToken: 'tok' } }));
    const calendar = { events: { list } } as any;

    await listCalendarEvents({ calendar, syncToken: 'abc' });

    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        showDeleted: true,
        syncToken: 'abc',
        orderBy: 'updated',
      })
    );
  });

  test('retries calendar list on invalid sync token', async () => {
    const list = jest
      .fn()
      .mockRejectedValueOnce({ code: 410 })
      .mockResolvedValueOnce({
        data: { items: [{ id: 'evt-1' }], nextSyncToken: 'tok-2' },
      });
    const calendar = { events: { list } } as any;

    const result = await listCalendarEvents({ calendar, syncToken: 'stale' });

    expect(list).toHaveBeenCalledTimes(2);
    expect(list.mock.calls[1][0].syncToken).toBeUndefined();
    expect(result.resetSyncToken).toBe(true);
    expect(result.items).toEqual([{ id: 'evt-1' }]);
  });

  test('flags cancelled calendar events', () => {
    const { isCancelled } = calendarEventToTaskPayload({
      event: { id: 'evt-9', status: 'cancelled' },
      caregiverId: 'caregiver-1',
      careRecipientId: 'hub-1',
    });

    expect(isCancelled).toBe(true);
  });
});
