import { DateTime } from 'luxon';

export const isValidIanaTimeZone = (timeZone: string) => {
  if (!timeZone) return false;
  const dt = DateTime.now().setZone(timeZone);
  return dt.isValid;
};

export const requireValidIanaTimeZone = (timeZone: string) => {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new Error(`Invalid timezone: ${timeZone}`);
  }
  return timeZone;
};

export const dayBoundsUtc = ({ timeZone, now }: { timeZone: string; now: Date }) => {
  const startLocal = DateTime.fromJSDate(now, { zone: timeZone }).startOf('day');
  const endLocal = startLocal.plus({ days: 1 });
  return {
    startUtc: startLocal.toUTC().toJSDate(),
    endUtc: endLocal.toUTC().toJSDate(),
  };
};

export const localDateString = ({ timeZone, now }: { timeZone: string; now: Date }) => {
  return DateTime.fromJSDate(now, { zone: timeZone }).toISODate();
};
