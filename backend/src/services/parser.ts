/**
 * Rules-based parser for classifying and extracting data from email/upload sources
 */

import type { ItemType, Source, AppointmentCreateRequest, BillCreateRequest } from '@carebase/shared';
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
  /\$\d+(?:,\d{3})*(?:\.\d{2})?/g,
  /\b\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:dollars?|USD)\b/gi
];

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

  // Extract amount
  let amount: number | undefined = undefined;
  const amountMatch =
    combined.match(/(?:amount due|total due|balance due|total|payment due)[^\d$]{0,20}\$?(\d+(?:,\d{3})*(?:\.\d{2})?)/i) ||
    combined.match(/\$\s?(\d+(?:,\d{3})*(?:\.\d{2})?)/);
  if (amountMatch) {
    const amountStr = amountMatch[1].replace(/,/g, '');
    const parsedAmount = parseFloat(amountStr);
    if (!Number.isNaN(parsedAmount)) {
      amount = parsedAmount;
    }
  }

  // Extract due date
  const parseDateToISO = (value: string | null | undefined): string | undefined => {
    if (!value) return undefined;
    const parsed = chrono.parseDate(value);
    if (!parsed) return undefined;
    return parsed.toISOString().split('T')[0];
  };

  let dueDate: string | undefined = undefined;
  const dueDateContext =
    combined.match(/(?:due date|pay by|payment due|on or before)[^\n]{0,50}/i)?.[0] ||
    combined.match(/due[\s:]+[^\n]{5,40}/i)?.[0];
  dueDate = parseDateToISO(dueDateContext) ?? parseDateToISO(combined);

  // Extract statement date
  let statementDate: string | undefined = undefined;
  const stmtContext =
    combined.match(/(?:statement date|service date|billing date)[^\n]{0,40}/i)?.[0];
  statementDate = parseDateToISO(stmtContext);

  // Extract payment URL
  const urlMatch = combined.match(/(?:pay at|payment link|pay online)[\s:]+(\S+)/i) ||
                   combined.match(/(https?:\/\/[^\s]+(?:pay|bill|invoice)[^\s]*)/i);
  const payUrl = urlMatch ? urlMatch[1] : undefined;

  return {
    statementDate,
    amount,
    dueDate,
    payUrl,
    status: 'todo'
  };
}

interface ParseResult {
  classification: ClassificationResult;
  appointmentData: AppointmentCreateRequest | null;
  billData: BillCreateRequest | null;
}

/**
 * Parse source and create appropriate item
 * @param source - Source record from database
 * @returns { classification, appointmentData, billData }
 */
export function parseSource(source: Source, fullText?: string): ParseResult {
  const text = (fullText && fullText.trim().length > 0) ? fullText : (source.shortExcerpt || '');
  const subject = source.subject || '';

  const classification = classifyText(`${subject}\n${text}`);

  let appointmentData: AppointmentCreateRequest | null = null;
  let billData: BillCreateRequest | null = null;

  if (classification.type === 'appointment') {
    appointmentData = extractAppointment(text, subject);
  } else if (classification.type === 'bill') {
    billData = extractBill(text, subject);
  }

  return {
    classification,
    appointmentData,
    billData
  };
}
