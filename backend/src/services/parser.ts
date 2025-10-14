/**
 * Rules-based parser for classifying and extracting data from email/upload sources
 */

import type { ItemType, Source, AppointmentCreateRequest, BillCreateRequest, BillStatus } from '@carebase/shared';
import * as chrono from 'chrono-node';

// Keywords and patterns for classification
const APPOINTMENT_KEYWORDS = [
  'appointment', 'visit', 'checkup', 'exam', 'consultation',
  'see you', 'scheduled', 'clinic', 'doctor', 'dr.', 'md',
  'hospital', 'medical center', 'health center'
];

const BILL_KEYWORDS = [
  'bill', 'invoice', 'payment', 'amount due', 'balance',
  'statement', 'charge', 'fee', 'pay by', 'due date',
  'account summary', 'billing'
];

const TIME_PATTERNS = [
  /\b\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)\b/g,
  /\b\d{1,2}\s*(?:am|pm|AM|PM)\b/g
];

const DATE_PATTERNS = [
  /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g,
  /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+\w+\s+\d{1,2}\b/gi
];

const MONEY_PATTERNS = [
  /\$\s?\d+(?:,\d{3})*(?:\.\d{2})?/g,
  /\b\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:dollars?|USD)\b/gi
];

const BILL_AMOUNT_KEYWORDS = [
  'amount due',
  'total due',
  'balance due',
  'please pay',
  'pay this amount',
  'total charges',
  'balance',
  'statement total'
];

const DUE_DATE_KEYWORDS = ['due date', 'date due', 'pay by', 'payment due', 'due on', 'pay on'];
const STATEMENT_DATE_KEYWORDS = ['statement date', 'billing date', 'service date', 'date of service'];

interface AmountCandidate {
  value: number;
  score: number;
}

function findBestAmount(text: string): number | undefined {
  const candidates: AmountCandidate[] = [];
  for (const match of text.matchAll(/\$?\s*\d+(?:,\d{3})*(?:\.\d{2})?/g)) {
    const original = match[0];
    const raw = original.replace(/[^0-9.]/g, '');
    const value = parseFloat(raw);
    if (Number.isNaN(value)) continue;
    const idx = match.index ?? 0;
    const contextStart = Math.max(0, idx - 40);
    const contextEnd = Math.min(text.length, idx + match[0].length + 40);
    const context = text.slice(contextStart, contextEnd).toLowerCase();

    const hasCurrencyIndicator =
      original.includes('$') ||
      original.toLowerCase().includes('usd') ||
      original.toLowerCase().includes('dollar') ||
      original.includes('.');

    if (!hasCurrencyIndicator && !BILL_AMOUNT_KEYWORDS.some((kw) => context.includes(kw))) {
      continue;
    }

    const prevChar = idx > 0 ? text[idx - 1] : '';
    const nextChar = idx + original.length < text.length ? text[idx + original.length] : '';

    if (!original.includes('$') && (context.includes('date') || prevChar === '/' || nextChar === '/')) {
      continue;
    }

    let score = 0;
    if (BILL_AMOUNT_KEYWORDS.some((kw) => context.includes(kw))) score += 3;
    if (context.includes('please pay') || context.includes('pay this amount')) score += 2;
    if (context.includes('amount due')) score += 2;
    if (context.includes('due')) score += 1;
    if (context.includes('balance')) score += 1.5;
    if (context.includes('total')) score += 0.5;
    if (value >= 50) score += 0.5;
    candidates.push({ value, score });
  }

  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => b.score - a.score || b.value - a.value);
  return candidates[0].value;
}

function normalizePatterns(patterns: RegExp[]): RegExp[] {
  return patterns.map((pattern) => {
    const flags = pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g';
    return new RegExp(pattern.source, flags);
  });
}

function parseDateString(candidate: string): string | undefined {
  const parsed = chrono.parseDate(candidate);
  if (!parsed) return undefined;
  return parsed.toISOString().split('T')[0];
}

function findDateWithContext(text: string, patterns: RegExp[], keywords: string[] = []): string | undefined {
  const searchPatterns = normalizePatterns(patterns);

  for (const pattern of searchPatterns) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const segment = match[1] ?? match[0];
      const iso = parseDateString(segment);
      if (iso) {
        pattern.lastIndex = 0;
        return iso;
      }
    }
    pattern.lastIndex = 0;
  }

  if (keywords.length > 0) {
    const lower = text.toLowerCase();
    for (const keyword of keywords) {
      let idx = lower.indexOf(keyword);
      while (idx !== -1) {
        const contextEnd = Math.min(text.length, idx + keyword.length + 200);
        const context = text.slice(idx, contextEnd);

        const contextIso = parseDateString(context);
        if (contextIso) {
          return contextIso;
        }

        const lookAhead = text.slice(idx + keyword.length, Math.min(text.length, idx + keyword.length + 200));
        for (const pattern of searchPatterns) {
          pattern.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(lookAhead)) !== null) {
            const segment = match[1] ?? match[0];
            const iso = parseDateString(segment);
            if (iso) {
              pattern.lastIndex = 0;
              return iso;
            }
          }
          pattern.lastIndex = 0;
        }

        idx = lower.indexOf(keyword, idx + keyword.length);
      }
    }
  }

  return undefined;
}

function isPastDate(isoDate?: string): boolean {
  if (!isoDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const candidate = new Date(isoDate);
  return candidate < today;
}

interface ClassificationResult {
  type: ItemType;
  confidence: number;
}

/**
 * Classify text as appointment, bill, or noise
 * @param text - Text to classify
 * @returns { type: string, confidence: number }
 */
export function classifyText(text: string): ClassificationResult {
  const lowerText = text.toLowerCase();

  // Count keyword matches
  const appointmentMatches = APPOINTMENT_KEYWORDS.filter(kw => lowerText.includes(kw)).length;
  const billMatches = BILL_KEYWORDS.filter(kw => lowerText.includes(kw)).length;

  // Check for patterns
  const hasTime = TIME_PATTERNS.some(pattern => pattern.test(text));
  const hasDate = DATE_PATTERNS.some(pattern => pattern.test(text));
  const hasMoney = MONEY_PATTERNS.some(pattern => pattern.test(text));

  // Scoring logic
  let appointmentScore = appointmentMatches * 0.3;
  let billScore = billMatches * 0.3;

  if (hasTime && hasDate) appointmentScore += 0.4;
  else if (hasDate) appointmentScore += 0.2;

  if (hasMoney && hasDate) billScore += 0.4;
  else if (hasMoney) billScore += 0.2;

  // Determine type and confidence
  if (appointmentScore > billScore && appointmentScore > 0.4) {
    return { type: 'appointment', confidence: Math.min(appointmentScore, 0.95) };
  } else if (billScore > appointmentScore && billScore > 0.4) {
    return { type: 'bill', confidence: Math.min(billScore, 0.95) };
  } else {
    return { type: 'noise', confidence: Math.max(appointmentScore, billScore) };
  }
}

/**
 * Extract appointment data from text
 * @param text - Source text
 * @param subject - Email subject or title
 * @returns Appointment data
 */
export function extractAppointment(text: string, subject: string): AppointmentCreateRequest {
  const combined = `${subject}\n${text}`;

  // Extract date
  let dateStr: string | null = null;
  for (const pattern of DATE_PATTERNS) {
    const match = combined.match(pattern);
    if (match) {
      dateStr = match[0];
      break;
    }
  }

  // Extract time
  let timeStr: string | null = null;
  for (const pattern of TIME_PATTERNS) {
    const match = combined.match(pattern);
    if (match) {
      timeStr = match[0];
      break;
    }
  }

  // Parse date and time (basic implementation)
  let startLocal = new Date();
  if (dateStr) {
    try {
      startLocal = new Date(dateStr);
      if (timeStr) {
        const timeMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s*(am|pm)/i);
        if (timeMatch) {
          let hours = parseInt(timeMatch[1]);
          const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
          const isPM = timeMatch[3].toLowerCase() === 'pm';
          if (isPM && hours < 12) hours += 12;
          if (!isPM && hours === 12) hours = 0;
          startLocal.setHours(hours, minutes, 0, 0);
        }
      }
    } catch (e) {
      console.error('Date parsing error:', e);
    }
  }

  // Default 1 hour visit
  const endLocal = new Date(startLocal);
  endLocal.setHours(startLocal.getHours() + 1);

  // Extract location (look for address-like patterns or clinic names)
  const locationMatch = combined.match(/(?:location:|address:|(?:^|\s)at\s)\s*([^\n]{10,80})/i);
  const location = locationMatch ? locationMatch[1].trim() : undefined;

  // Extract prep note (look for "bring", "prepare", "remember")
  const prepMatch = combined.match(/(?:bring|prepare|remember|arrive|check-in)[\s:]+([^\n]{10,100})/i);
  const prepNote = prepMatch ? prepMatch[1].trim() : undefined;

  // Generate summary from subject or first line
  const summary = subject || text.split('\n')[0].substring(0, 100);

  return {
    startLocal: startLocal.toISOString(),
    endLocal: endLocal.toISOString(),
    location,
    prepNote,
    summary
  };
}

/**
 * Extract bill data from text
 * @param text - Source text
 * @param subject - Email subject or title
 * @returns Bill data
 */
export function extractBill(text: string, subject: string): BillCreateRequest {
  const combined = `${subject}\n${text}`;

  const amount = findBestAmount(combined);

  const dueDate = findDateWithContext(combined, [
    /(?:due date|date due|pay by|payment due|due on|pay on)[\s:]{0,10}([\s\S]{0,50})/i
  ], DUE_DATE_KEYWORDS);

  const statementDate = findDateWithContext(combined, [
    /(?:statement date|service date|billing date)[\s:]{0,10}([\s\S]{0,40})/i
  ], STATEMENT_DATE_KEYWORDS);

  const urlMatch = combined.match(/(?:pay at|payment link|pay online)[\s:]+(\S+)/i) ||
                   combined.match(/(https?:\/\/[^\s]+(?:pay|bill|invoice)[^\s]*)/i);
  const payUrl = urlMatch ? urlMatch[1] : undefined;

  let status: BillStatus = 'todo';
  if (dueDate && isPastDate(dueDate)) {
    status = 'overdue';
  }

  return {
    statementDate,
    amount,
    dueDate,
    payUrl,
    status
  };
}

interface ParseResult {
  classification: ClassificationResult;
  appointmentData: AppointmentCreateRequest | null;
  billData: BillCreateRequest | null;
  billOverdue: boolean;
}

/**
 * Parse source and create appropriate item
 * @param source - Source record from database
 * @returns { classification, appointmentData, billData }
 */
export function parseSource(source: Source, fullText?: string): ParseResult {
  const text = (fullText && fullText.trim().length > 0) ? fullText : (source.shortExcerpt || '');
  const subject = source.subject || '';

  let classification = classifyText(`${subject}\n${text}`);

  const appointmentCandidate = extractAppointment(text, subject);
  const billCandidate = extractBill(text, subject);

  const billHasSignal =
    billCandidate.amount !== undefined ||
    billCandidate.dueDate !== undefined ||
    !!billCandidate.payUrl;

  if (billHasSignal && classification.type !== 'bill') {
    classification = {
      type: 'bill',
      confidence: Math.max(classification.confidence, 0.85)
    };
  }

  let appointmentData: AppointmentCreateRequest | null = null;
  let billData: BillCreateRequest | null = null;
  let billOverdue = false;

  if (classification.type === 'bill') {
    billData = billCandidate;
    billOverdue = billCandidate.status === 'overdue' || isPastDate(billCandidate.dueDate);
    if (billData && billOverdue && billData.status !== 'overdue') {
      billData = { ...billData, status: 'overdue' };
    }
  } else if (classification.type === 'appointment') {
    appointmentData = appointmentCandidate;
  }

  return {
    classification,
    appointmentData,
    billData,
    billOverdue
  };
}
