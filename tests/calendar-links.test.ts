import { CALSHOW_EPOCH_OFFSET_SECONDS, buildCalshowUrl } from '../lib/calendar-links';

describe('calendar links', () => {
  test('buildCalshowUrl uses iOS epoch (2001-01-01)', () => {
    const date = new Date('2025-01-01T00:00:00Z');
    const unixSeconds = Math.floor(date.getTime() / 1000);
    const expected = `calshow:${unixSeconds - CALSHOW_EPOCH_OFFSET_SECONDS}`;

    expect(buildCalshowUrl(date)).toBe(expected);
  });
});
