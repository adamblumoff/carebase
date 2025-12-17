import { google } from 'googleapis';

const MAX_DESCRIPTION_LENGTH = 2000;

export type ParsedDetails = {
  title: string;
  type: 'appointment' | 'bill' | 'medication' | 'general';
  confidence: number;
  description?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  location?: string | null;
  organizer?: string | null;
  attendees?: string[] | null;
  amount?: number | null;
  currency?: string | null;
  vendor?: string | null;
  referenceNumber?: string | null;
  statementPeriod?: string | null;
  dueAt?: Date | null;
  medicationName?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  route?: string | null;
  nextDoseAt?: Date | null;
  prescribingProvider?: string | null;
};

type Message = google.gmail_v1.Schema$Message;

type FlattenedPart = {
  mimeType?: string | null;
  filename?: string | null;
  data?: string | null;
  headers?: { name?: string | null; value?: string | null }[] | null;
};

const htmlEntityMap: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const decodeHtmlEntities = (text: string) =>
  text.replace(/&([a-z]{2,6});/gi, (_m, g1) => htmlEntityMap[g1] ?? _m);

const stripHtml = (html: string) => {
  const withoutTags = html.replace(/<[^>]+>/g, ' ');
  return decodeHtmlEntities(withoutTags);
};

const normalizeWhitespacePreserveNewlines = (value: string) => {
  const normalizedNewlines = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const collapsedSpaces = normalizedNewlines
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trimEnd())
    .join('\n');
  return collapsedSpaces.replace(/\n{3,}/g, '\n\n').trim();
};

const normalizeWhitespace = (value: string) =>
  normalizeWhitespacePreserveNewlines(value).replace(/\n+/g, ' ').trim();

const base64ToString = (data: string) => Buffer.from(data, 'base64').toString('utf8');

const flattenParts = (payload?: google.gmail_v1.Schema$MessagePart | null): FlattenedPart[] => {
  if (!payload) return [];
  const parts: FlattenedPart[] = [];

  const walk = (part?: google.gmail_v1.Schema$MessagePart | null) => {
    if (!part) return;
    if (part.body?.data) {
      parts.push({
        mimeType: part.mimeType,
        filename: part.filename,
        data: part.body.data,
        headers: part.headers ?? [],
      });
    }
    if (part.parts) {
      part.parts.forEach((p) => walk(p));
    }
  };

  walk(payload);
  return parts;
};

const pickTextBody = (parts: FlattenedPart[]): { text?: string; html?: string } => {
  let text: string | undefined;
  let html: string | undefined;
  for (const part of parts) {
    if (!part.data) continue;
    const decoded = base64ToString(part.data);
    if (part.mimeType?.startsWith('text/plain') && !text) {
      text = decoded;
    }
    if (part.mimeType?.startsWith('text/html') && !html) {
      html = decoded;
    }
  }
  return { text, html };
};

const stripCommonFooterNoise = (value: string) => {
  const lower = value.toLowerCase();
  const cutMarkers = [
    '\nunsubscribe',
    '\nmanage preferences',
    '\nupdate your preferences',
    '\nprivacy policy',
    '\nterms of service',
    '\nview in browser',
  ];
  const cutAt = cutMarkers
    .map((marker) => lower.indexOf(marker))
    .filter((idx) => idx >= 0)
    .sort((a, b) => a - b)[0];
  if (cutAt === undefined) return value;
  if (cutAt < 200) return value;
  return value.slice(0, cutAt).trim();
};

const toPlainDescription = (text?: string, html?: string) => {
  const raw = text ?? (html ? stripHtml(html) : null);
  if (!raw) return null;
  const normalized = normalizeWhitespacePreserveNewlines(raw);
  const trimmedNoise = stripCommonFooterNoise(normalized);
  return trimmedNoise.slice(0, MAX_DESCRIPTION_LENGTH);
};

const parseDateTokens = (value: string): Date | null => {
  // Support ISO, mm/dd/yyyy, Month dd, yyyy patterns.
  const isoMatch = value.match(/\d{4}-\d{2}-\d{2}(?:[Tt]\d{2}:\d{2}(?::\d{2})?)?/);
  if (isoMatch) {
    const parsed = new Date(isoMatch[0]);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const slashMatch = value.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (slashMatch) {
    const [, m, d, y] = slashMatch;
    const year = y.length === 2 ? Number(`20${y}`) : Number(y);
    const parsed = new Date(year, Number(m) - 1, Number(d));
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const verbose = value.match(
    /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}/i
  );
  if (verbose) {
    const parsed = new Date(verbose[0]);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return null;
};

const extractIcsDetails = (parts: FlattenedPart[]) => {
  for (const part of parts) {
    if (!part.data) continue;
    if (part.mimeType !== 'text/calendar' && part.filename !== 'invite.ics') continue;
    const content = base64ToString(part.data);
    const dtStart = content.match(/DTSTART[^:]*:(.+)/);
    const dtEnd = content.match(/DTEND[^:]*:(.+)/);
    const location = content.match(/LOCATION:(.+)/);
    const organizer = content.match(/ORGANIZER;?.*:(.+)/);

    const parseIcsDate = (raw?: string | null) => {
      if (!raw) return null;
      const cleaned = raw.trim();
      const year = cleaned.slice(0, 4);
      const month = cleaned.slice(4, 6);
      const day = cleaned.slice(6, 8);
      const hour = cleaned.slice(9, 11) || '00';
      const minute = cleaned.slice(11, 13) || '00';
      const second = cleaned.slice(13, 15) || '00';
      const asDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
      return Number.isNaN(asDate.getTime()) ? null : asDate;
    };

    return {
      startAt: parseIcsDate(dtStart?.[1]) ?? null,
      endAt: parseIcsDate(dtEnd?.[1]) ?? null,
      location: location?.[1]?.trim() ?? null,
      organizer: organizer?.[1]?.trim() ?? null,
    };
  }

  return null;
};

const parseAmount = (text: string) => {
  const match = text.match(/\$\s?([0-9]{1,6}(?:,[0-9]{3})*(?:\.[0-9]{2})?)/);
  if (match) {
    const normalized = match[1].replace(/,/g, '');
    return { amount: Number(normalized), currency: 'USD' as const };
  }
  return null;
};

const parseDueAt = (text: string) => {
  const match = text.match(/due\s+(on|by)\s+([^.,\n]+)/i);
  if (match) {
    const parsed = parseDateTokens(match[2]);
    if (parsed) return parsed;
  }
  return null;
};

const parseStatementPeriod = (text: string) => {
  const match = text.match(/statement\s+period[:\s]+([^\n]+)/i);
  return match ? normalizeWhitespace(match[1]) : null;
};

const parseReferenceNumber = (text: string) => {
  const match = text.match(/(invoice|statement|account)\s*(#|number)?\s*[:]?\s*([A-Z0-9-]{4,})/i);
  return match ? match[3] : null;
};

const parseVendor = (sender?: string | null, bodyText?: string | null) => {
  if (sender) {
    const fromAddress = sender.match(/@([^>\s]+)/);
    if (fromAddress) return fromAddress[1].replace(/>.*/, '');
  }
  if (bodyText) {
    const match = bodyText.match(/from\s+([A-Z][A-Za-z0-9 &'-]{2,40})/i);
    if (match) return match[1];
  }
  return null;
};

const parseMedicationDetails = (text: string, subject: string) => {
  const medicationName = (() => {
    const nameMatch =
      subject.match(/(rx|prescription):?\s*(.+)/i) ?? text.match(/medication[:\s]+(.+)/i);
    return nameMatch
      ? normalizeWhitespacePreserveNewlines(nameMatch[2] ?? nameMatch[1])
      : subject.trim();
  })();

  const dosage = (() => {
    const match = text.match(/(\d+\s?(mg|mcg|ml|mL|tabs?))/i);
    return match ? match[0] : null;
  })();

  const frequency = (() => {
    const patterns = [
      /(once|twice) daily/i,
      /\bq\d+h\b/i,
      /every\s+\d+\s*(hours|hrs|days)/i,
      /\b(bid|tid|qid)\b/i,
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) return match[0];
    }
    return null;
  })();

  const route = (() => {
    const match = text.match(/\b(oral|topical|inhal(ed|ation)?|ophthalmic|nasal)\b/i);
    return match ? match[1] : null;
  })();

  const prescribingProvider = (() => {
    const match = text.match(/Dr\.\s+[A-Z][A-Za-z]+\s+[A-Z][A-Za-z]+/);
    return match ? match[0] : null;
  })();

  return { medicationName, dosage, frequency, route, prescribingProvider };
};

const selectType = (subject: string, snippet: string, body: string | null) => {
  const haystack = `${subject} ${snippet} ${body ?? ''}`.toLowerCase();
  if (/appointment|appt|calendar|meeting/.test(haystack)) return 'appointment' as const;
  if (/bill|invoice|statement|amount due|payment/.test(haystack)) return 'bill' as const;
  if (/medication|prescription|rx|refill/.test(haystack)) return 'medication' as const;
  return 'general' as const;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const computeParserConfidence = ({
  type,
  hasIcs,
  details,
  bodyText,
}: {
  type: ParsedDetails['type'];
  hasIcs: boolean;
  details: Omit<ParsedDetails, 'confidence'>;
  bodyText: string;
}) => {
  const hasDateToken = Boolean(parseDateTokens(bodyText));

  let confidence =
    type === 'appointment' ? 0.72 : type === 'bill' ? 0.62 : type === 'medication' ? 0.58 : 0.35;

  if (type === 'appointment') {
    if (hasIcs) confidence += 0.16;
    if (details.startAt) confidence += 0.1;
    if (details.location || details.organizer) confidence += 0.08;
    if (!hasIcs && !details.startAt && !details.location && !details.organizer && !hasDateToken) {
      confidence -= 0.25;
    }
  }

  if (type === 'bill') {
    if (typeof details.amount === 'number') confidence += 0.14;
    if (details.dueAt) confidence += 0.12;
    if (details.referenceNumber) confidence += 0.08;
    if (details.vendor) confidence += 0.06;
    if (
      typeof details.amount !== 'number' &&
      !details.dueAt &&
      !details.referenceNumber &&
      !details.vendor
    ) {
      confidence -= 0.22;
    }
  }

  if (type === 'medication') {
    if (details.dosage) confidence += 0.12;
    if (details.frequency) confidence += 0.1;
    if (details.prescribingProvider) confidence += 0.08;
    if (!details.dosage && !details.frequency && !details.prescribingProvider) {
      confidence -= 0.2;
    }
  }

  if (type === 'general') {
    if (hasDateToken) confidence += 0.08;
    if (/\b(action required|please|follow up|confirm)\b/i.test(bodyText)) confidence += 0.07;
    if (/\b(unsubscribe|sale|discount|promo|offer)\b/i.test(bodyText)) confidence -= 0.12;
  }

  return clamp01(Math.min(0.95, Math.max(0.05, confidence)));
};

export const parseMessage = ({
  message,
  subject,
  sender,
  snippet,
}: {
  message: Message;
  subject: string;
  sender?: string | null;
  snippet: string;
}): ParsedDetails => {
  const parts = flattenParts(message.payload);
  const { text, html } = pickTextBody(parts);
  const description = toPlainDescription(text, html);

  const bodyText = description ?? snippet ?? '';
  const type = selectType(subject, snippet, bodyText);

  const ics = extractIcsDetails(parts);

  const resultWithoutConfidence: Omit<ParsedDetails, 'confidence'> = {
    title: subject.trim() || 'Task',
    type,
    description,
    startAt: ics?.startAt ?? null,
    endAt: ics?.endAt ?? null,
    location: ics?.location ?? null,
    organizer: ics?.organizer ?? null,
    attendees: null,
    amount: null,
    currency: null,
    vendor: null,
    referenceNumber: null,
    statementPeriod: null,
    dueAt: null,
    medicationName: null,
    dosage: null,
    frequency: null,
    route: null,
    nextDoseAt: null,
    prescribingProvider: null,
  };

  if (type === 'bill') {
    const amt = parseAmount(bodyText);
    if (amt) {
      resultWithoutConfidence.amount = amt.amount;
      resultWithoutConfidence.currency = amt.currency;
    }
    resultWithoutConfidence.dueAt = parseDueAt(bodyText);
    resultWithoutConfidence.vendor = parseVendor(sender, bodyText);
    resultWithoutConfidence.statementPeriod = parseStatementPeriod(bodyText);
    resultWithoutConfidence.referenceNumber = parseReferenceNumber(bodyText);
  }

  if (type === 'appointment') {
    if (!resultWithoutConfidence.location) {
      const loc = bodyText.match(/location[:\s]+([^\n]+)/i);
      if (loc) resultWithoutConfidence.location = normalizeWhitespace(loc[1]);
    }
    if (!resultWithoutConfidence.startAt) {
      const date = parseDateTokens(bodyText);
      if (date) resultWithoutConfidence.startAt = date;
    }
  }

  if (type === 'medication') {
    const medDetails = parseMedicationDetails(bodyText, subject);
    resultWithoutConfidence.medicationName = medDetails.medicationName ?? subject;
    resultWithoutConfidence.dosage = medDetails.dosage;
    resultWithoutConfidence.frequency = medDetails.frequency;
    resultWithoutConfidence.route = medDetails.route;
    resultWithoutConfidence.prescribingProvider = medDetails.prescribingProvider;
  }

  const confidence = computeParserConfidence({
    type,
    hasIcs: Boolean(ics),
    details: resultWithoutConfidence,
    bodyText,
  });

  return { ...resultWithoutConfidence, confidence };
};
