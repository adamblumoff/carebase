export const parseServerDate = (value: string): Date => new Date(value);

export const formatDisplayDate = (date: Date): string =>
  date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

export const formatDisplayTime = (date: Date): string =>
  date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit'
  });

const pad = (value: number) => value.toString().padStart(2, '0');

export const formatForPayload = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
