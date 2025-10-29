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
