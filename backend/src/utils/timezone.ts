const formatterCache = new Map<string, Intl.DateTimeFormat>();

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const zeroPad = (value: number) => value.toString().padStart(2, '0');

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'shortOffset'
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function getUtcParts(date: Date): DateParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds()
  };
}

function formatLocalDateTime(parts: DateParts): string {
  return `${parts.year}-${zeroPad(parts.month)}-${zeroPad(parts.day)}T${zeroPad(parts.hour)}:${zeroPad(parts.minute)}:${zeroPad(parts.second)}`;
}

function parseDateParts(parts: Intl.DateTimeFormatPart[]): DateParts {
  const parsed: Partial<DateParts> = {};
  for (const part of parts) {
    switch (part.type) {
      case 'year':
        parsed.year = Number.parseInt(part.value, 10);
        break;
      case 'month':
        parsed.month = Number.parseInt(part.value, 10);
        break;
      case 'day':
        parsed.day = Number.parseInt(part.value, 10);
        break;
      case 'hour':
        parsed.hour = Number.parseInt(part.value, 10);
        break;
      case 'minute':
        parsed.minute = Number.parseInt(part.value, 10);
        break;
      case 'second':
        parsed.second = Number.parseInt(part.value, 10);
        break;
      default:
        break;
    }
  }
  return {
    year: parsed.year ?? 0,
    month: parsed.month ?? 1,
    day: parsed.day ?? 1,
    hour: parsed.hour ?? 0,
    minute: parsed.minute ?? 0,
    second: parsed.second ?? 0
  };
}

function diffInMinutes(target: DateParts, actual: DateParts): number {
  const targetMillis = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second);
  const actualMillis = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
  return Math.round((targetMillis - actualMillis) / 60000);
}

function normalizeOffset(offsetRaw: string | undefined): string {
  if (!offsetRaw) {
    return '+00:00';
  }
  const sanitized = offsetRaw.replace('GMT', '').replace('UTC', '').replace('\u2212', '-').trim();
  const match = sanitized.match(/([+-]?)(\d{1,2})(?::?(\d{2}))?/);
  if (!match) {
    return '+00:00';
  }
  const sign = match[1] && match[1] !== '' ? (match[1] === '-' ? '-' : '+') : '+';
  const hours = match[2].padStart(2, '0');
  const minutes = (match[3] ?? '00').padEnd(2, '0');
  return `${sign}${hours}:${minutes}`;
}

function resolveOffset(parts: DateParts, timeZone: string): string {
  const formatter = getFormatter(timeZone);
  let timestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let formattedParts = parseDateParts(formatter.formatToParts(new Date(timestamp)));
  let diff = diffInMinutes(parts, formattedParts);

  if (diff !== 0) {
    timestamp += diff * 60000;
    formattedParts = parseDateParts(formatter.formatToParts(new Date(timestamp)));
    const remainingDiff = diffInMinutes(parts, formattedParts);
    if (remainingDiff !== 0) {
      // leave the diff; formatter best effort
    }
  }

  const offsetRaw = formatter.formatToParts(new Date(timestamp)).find((part) => part.type === 'timeZoneName')?.value;
  return normalizeOffset(offsetRaw);
}

export function getDefaultTimeZone(): string {
  return process.env.GOOGLE_SYNC_DEFAULT_TIME_ZONE ?? process.env.DEFAULT_TIME_ZONE ?? 'UTC';
}

export function formatDateTimeWithTimeZone(date: Date, timeZone: string): { local: string; offset: string } {
  const parts = getUtcParts(date);
  const local = formatLocalDateTime(parts);
  const offset = resolveOffset(parts, timeZone);
  return { local, offset };
}

export function formatDateTimeForZone(input: Date | string, timeZone?: string): string {
  const zone = timeZone ?? getDefaultTimeZone();
  const date = input instanceof Date ? input : new Date(input);
  const { local, offset } = formatDateTimeWithTimeZone(date, zone);
  return `${local}${offset}`;
}
