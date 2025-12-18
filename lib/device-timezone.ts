import * as Localization from 'expo-localization';

export const getDeviceTimeZone = () => {
  try {
    const intlZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (intlZone && typeof intlZone === 'string') return intlZone;
  } catch {
    // ignore
  }

  const calendars = Localization.getCalendars?.() ?? [];
  const calendarZone = calendars.find((calendar) => calendar.timeZone)?.timeZone ?? null;
  if (calendarZone && typeof calendarZone === 'string') return calendarZone;

  return null;
};
