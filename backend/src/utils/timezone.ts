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

function getLocalParts(date: Date): DateParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds()
  };
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
  const formatter = getFormatter(timeZone);
  const localParts = parseDateParts(formatter.formatToParts(date));
  const local = formatLocalDateTime(localParts);
  const offset = resolveOffset(localParts, timeZone);
  return { local, offset };
}

export function formatDateTimeForZone(input: Date | string, timeZone?: string): string {
  const zone = timeZone ?? getDefaultTimeZone();
  const date = input instanceof Date ? input : new Date(input);
  const { local, offset } = formatDateTimeWithTimeZone(date, zone);
  return `${local}${offset}`;
}

export function formatInstantWithZone(date: Date, timeZone: string): { dateTime: string; timeZone: string } {
  // getFormatter will throw RangeError if the timezone is invalid
  getFormatter(timeZone);
  const { local, offset } = formatDateTimeWithTimeZone(date, timeZone);
  return {
    dateTime: `${local}${offset}`,
    timeZone
  };
}

function parseTimeOfDay(value: string): { hour: number; minute: number; second: number } {
  const parts = value.split(':');
  if (parts.length < 2 || parts.length > 3) {
    throw new Error(`Invalid time of day: ${value}`);
  }
  const [hourRaw, minuteRaw, secondRaw] = parts;
  const hour = Number.parseInt(hourRaw, 10);
  const minute = Number.parseInt(minuteRaw, 10);
  const second = secondRaw !== undefined ? Number.parseInt(secondRaw, 10) : 0;

  if (
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    Number.isNaN(second) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    throw new Error(`Invalid time of day: ${value}`);
  }

  return { hour, minute, second };
}

function offsetToMinutes(offset: string): number {
  const sign = offset.startsWith('-') ? -1 : 1;
  const [hourComponent = '0', minuteComponent = '0'] = offset.slice(1).split(':');
  const hours = Number.parseInt(hourComponent, 10);
  const minutes = Number.parseInt(minuteComponent, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return 0;
  }
  return sign * (hours * 60 + minutes);
}

export function combineDateWithTimeZone(date: Date, timeOfDay: string, timeZone: string): Date {
  const { hour, minute, second } = parseTimeOfDay(timeOfDay);

  const targetParts: DateParts = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour,
    minute,
    second
  };

  const offset = resolveOffset(targetParts, timeZone);
  const offsetMinutes = offsetToMinutes(offset);

  const utcMillis = Date.UTC(
    targetParts.year,
    targetParts.month - 1,
    targetParts.day,
    hour,
    minute,
    second
  ) - offsetMinutes * 60000;

  return new Date(utcMillis);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    getFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

function parseLocalDateTimeString(input: string): DateParts {
  const match = input.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/
  );
  if (!match) {
    throw new Error(`Invalid local datetime string: ${input}`);
  }
  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10),
    hour: Number.parseInt(match[4], 10),
    minute: Number.parseInt(match[5], 10),
    second: match[6] ? Number.parseInt(match[6], 10) : 0
  };
}

export function toUtcDateFromLocalTime(
  input: Date | string,
  timeZone: string
): Date {
  if (typeof input === 'string' && /([+-]\d{2}:\d{2}|Z)$/i.test(input)) {
    return new Date(input);
  }

  const parts =
    typeof input === 'string' ? parseLocalDateTimeString(input) : getLocalParts(input);
  const offset = resolveOffset(parts, timeZone);
  const sign = offset.startsWith('-') ? -1 : 1;
  const hours = Number.parseInt(offset.slice(1, 3), 10);
  const minutes = Number.parseInt(offset.slice(4, 6), 10);
  const totalMinutes = sign * (hours * 60 + minutes);
  const utcMillis =
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    ) -
    totalMinutes * 60000;
  return new Date(utcMillis);
}
