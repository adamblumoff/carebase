import { getPushSyncTarget } from '../api/lib/pushWebhook';

describe('push webhook routing', () => {
  test('pubsub pushes always route to gmail sync', () => {
    expect(
      getPushSyncTarget({
        isPubsubPush: true,
        channelId: undefined,
        calendarChannelId: undefined,
      })
    ).toBe('gmail');
  });

  test('calendar channel routes to calendar sync', () => {
    expect(
      getPushSyncTarget({
        isPubsubPush: false,
        channelId: 'cal-1',
        calendarChannelId: 'cal-1',
      })
    ).toBe('calendar');
  });

  test('unknown channel defaults to gmail sync', () => {
    expect(
      getPushSyncTarget({
        isPubsubPush: false,
        channelId: 'other',
        calendarChannelId: 'cal-1',
      })
    ).toBe('gmail');
  });
});
