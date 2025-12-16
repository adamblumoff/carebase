import type { ClassificationBucket, ParsedDetailsLike } from '../../api/lib/ingestionHeuristics';

export type FixtureCase = 'tp' | 'tn' | 'fp' | 'fn';
export type FixtureKind = 'appointment' | 'bill' | 'medication';

export type ClassificationFixture = {
  kind: FixtureKind;
  case: FixtureCase;
  name: string;
  subject: string;
  snippet: string;
  bulkSignals: boolean;
  classificationFailed: boolean;
  bucket: ClassificationBucket;
  modelConfidence: number | null;
  parsed: ParsedDetailsLike;
  expected: {
    taskType: ParsedDetailsLike['type'];
    reviewState: 'pending' | 'approved' | 'ignored';
    shouldDrop: boolean;
  };
};

const baseParsed = (title: string, confidence = 0.5): ParsedDetailsLike => ({
  title,
  type: 'general',
  confidence,
  description: null,
  location: null,
  organizer: null,
  amount: null,
  vendor: null,
  referenceNumber: null,
  statementPeriod: null,
  dueAt: null,
  dosage: null,
  frequency: null,
  prescribingProvider: null,
});

export const classificationFixtures: ClassificationFixture[] = [
  // Appointments
  {
    kind: 'appointment',
    case: 'tp',
    name: 'Appointment confirmation with date + location',
    subject: 'Appointment confirmed: Dr. Patel — Tue Jan 21, 2026 2:30 PM',
    snippet: 'Your appointment is confirmed for Jan 21 at 2:30 PM at 123 Main St.',
    bulkSignals: false,
    classificationFailed: false,
    bucket: 'appointments',
    modelConfidence: 0.92,
    parsed: {
      ...baseParsed('Appointment confirmed: Dr. Patel — Tue Jan 21, 2026 2:30 PM', 0.7),
      startAt: new Date('2026-01-21T14:30:00Z'),
      location: '123 Main St',
      organizer: 'Example Health',
    },
    expected: { taskType: 'appointment', reviewState: 'approved', shouldDrop: false },
  },
  {
    kind: 'appointment',
    case: 'tn',
    name: 'Account settings reminder should be ignored',
    subject: 'Reminder: update your profile information',
    snippet: 'Update your profile to keep your account secure.',
    bulkSignals: false,
    classificationFailed: false,
    bucket: 'ignore',
    modelConfidence: 0.9,
    parsed: baseParsed('Reminder: update your profile information'),
    expected: { taskType: 'general', reviewState: 'ignored', shouldDrop: false },
  },
  {
    kind: 'appointment',
    case: 'fp',
    name: 'Maintenance window looks like a schedule but is not a care appointment',
    subject: '[CLUSTER] FrostByte Cluster Maintenance – January 6, 2026 (8:00 AM–8:00 PM)',
    snippet: 'Scheduled maintenance on Monday, January 6, from 8:00 AM to 8:00 PM.',
    bulkSignals: false,
    classificationFailed: false,
    bucket: 'appointments',
    modelConfidence: 0.9,
    parsed: {
      ...baseParsed('[CLUSTER] FrostByte Cluster Maintenance – January 6, 2026 (8:00 AM–8:00 PM)'),
      startAt: new Date('2026-01-06T08:00:00Z'),
    },
    expected: { taskType: 'appointment', reviewState: 'pending', shouldDrop: false },
  },
  {
    kind: 'appointment',
    case: 'fn',
    name: 'Low model confidence but strong evidence (date + location) should not be dropped',
    subject: 'Your visit is tomorrow',
    snippet: 'See you at 9:00 AM at 123 Main St.',
    bulkSignals: false,
    classificationFailed: false,
    bucket: 'appointments',
    modelConfidence: 0.55,
    parsed: {
      ...baseParsed('Your visit is tomorrow', 0.55),
      startAt: new Date('2026-01-02T09:00:00Z'),
      location: '123 Main St',
    },
    expected: { taskType: 'appointment', reviewState: 'pending', shouldDrop: false },
  },

  // Bills
  {
    kind: 'bill',
    case: 'tp',
    name: 'Bill statement with amount due + due date',
    subject: 'Statement ready — Amount due $42.17 by Feb 5, 2026',
    snippet: 'Your amount due is $42.17. Pay by Feb 5, 2026 to avoid fees.',
    bulkSignals: false,
    classificationFailed: false,
    bucket: 'bills',
    modelConfidence: 0.95,
    parsed: {
      ...baseParsed('Statement ready — Amount due $42.17 by Feb 5, 2026'),
      amount: 42.17,
      currency: 'USD',
      dueAt: new Date('2026-02-05T00:00:00Z'),
      vendor: 'Regional Hospital',
    },
    expected: { taskType: 'bill', reviewState: 'approved', shouldDrop: false },
  },
  {
    kind: 'bill',
    case: 'tn',
    name: 'Receipt/thanks email should be ignored',
    subject: 'Thanks for your payment',
    snippet: 'We received your payment. No balance is due.',
    bulkSignals: false,
    classificationFailed: false,
    bucket: 'ignore',
    modelConfidence: 0.8,
    parsed: baseParsed('Thanks for your payment'),
    expected: { taskType: 'general', reviewState: 'ignored', shouldDrop: false },
  },
  {
    kind: 'bill',
    case: 'fp',
    name: 'Benefits marketing should not auto-create a bill',
    subject: 'Let your benefits do more for you',
    snippet:
      'As a client, you have access to rewards including up to a $200 card statement credit.',
    bulkSignals: true,
    classificationFailed: false,
    bucket: 'bills',
    modelConfidence: 0.9,
    parsed: baseParsed('Let your benefits do more for you'),
    expected: { taskType: 'bill', reviewState: 'pending', shouldDrop: false },
  },
  {
    kind: 'bill',
    case: 'fn',
    name: 'Low model confidence but invoice evidence should not be dropped',
    subject: 'Invoice INV-10022 available',
    snippet: 'Amount due $128.00 due by March 1, 2026.',
    bulkSignals: false,
    classificationFailed: false,
    bucket: 'bills',
    modelConfidence: 0.55,
    parsed: {
      ...baseParsed('Invoice INV-10022 available'),
      amount: 128,
      dueAt: new Date('2026-03-01T00:00:00Z'),
      referenceNumber: 'INV-10022',
    },
    expected: { taskType: 'bill', reviewState: 'pending', shouldDrop: false },
  },

  // Medications
  {
    kind: 'medication',
    case: 'tp',
    name: 'Rx refill ready with medication + dose',
    subject: 'Rx refill ready: Atorvastatin 20mg',
    snippet: 'Your refill is ready. Atorvastatin 20mg. Pick up today.',
    bulkSignals: false,
    classificationFailed: false,
    bucket: 'medications',
    modelConfidence: 0.9,
    parsed: {
      ...baseParsed('Rx refill ready: Atorvastatin 20mg'),
      medicationName: 'Atorvastatin',
      dosage: '20mg',
      frequency: 'once daily',
      prescribingProvider: 'Dr. Nguyen',
    },
    expected: { taskType: 'medication', reviewState: 'approved', shouldDrop: false },
  },
  {
    kind: 'medication',
    case: 'tn',
    name: 'Generic marketing email should be ignored',
    subject: 'New arrivals this week',
    snippet: 'Check out new items and deals.',
    bulkSignals: true,
    classificationFailed: false,
    bucket: 'ignore',
    modelConfidence: 0.9,
    parsed: baseParsed('New arrivals this week'),
    expected: { taskType: 'general', reviewState: 'ignored', shouldDrop: false },
  },
  {
    kind: 'medication',
    case: 'fp',
    name: 'Contacts discount should not auto-create medication task',
    subject: 'Unwrap 25% off your contacts 🎁',
    snippet: "Don't wait, this flash sale ends soon",
    bulkSignals: true,
    classificationFailed: false,
    bucket: 'medications',
    modelConfidence: 0.9,
    parsed: baseParsed('Unwrap 25% off your contacts 🎁'),
    expected: { taskType: 'medication', reviewState: 'pending', shouldDrop: false },
  },
  {
    kind: 'medication',
    case: 'fn',
    name: 'Low model confidence but Rx evidence should not be dropped',
    subject: 'Prescription is delayed',
    snippet: 'Your prescription is delayed. Contact pharmacy for refill options.',
    bulkSignals: false,
    classificationFailed: false,
    bucket: 'medications',
    modelConfidence: 0.55,
    parsed: {
      ...baseParsed('Prescription is delayed'),
      medicationName: 'Unknown',
      dosage: '10mg',
      frequency: 'daily',
    },
    expected: { taskType: 'medication', reviewState: 'pending', shouldDrop: false },
  },
];
