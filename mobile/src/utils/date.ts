type DateInput = Date | string | number | null | undefined;

export const parseServerDate = (value: string): Date => new Date(value);

const coerceDate = (input: DateInput): Date | null => {
  if (input == null) return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  const date = typeof input === 'number' ? new Date(input) : new Date(String(input));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatDisplayDate = (input: DateInput): string => {
  const date = coerceDate(input);
  if (!date) return '';
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
};

export const formatDisplayTime = (input: DateInput): string => {
  const date = coerceDate(input);
  if (!date) return '';
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });
};

const pad = (value: number) => value.toString().padStart(2, '0');

export const formatForPayload = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

const resolveTimeZone = (timeZone?: string): string => {
  if (timeZone && timeZone.trim().length > 0) {
    return timeZone.trim();
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
  } catch {
    return 'UTC';
  }
};

export const formatDateKeyInZone = (input: DateInput, timeZone?: string): string => {
  const date = coerceDate(input);
  if (!date) return '';
  const zone = resolveTimeZone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  let year = '1970';
  let month = '01';
  let day = '01';
  for (const part of formatter.formatToParts(date)) {
    if (part.type === 'year') {
      year = part.value;
    } else if (part.type === 'month') {
      month = part.value;
    } else if (part.type === 'day') {
      day = part.value;
    }
  }
  return `${year}-${month}-${day}`;
};
