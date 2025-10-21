import { test } from 'node:test';
import assert from 'node:assert';
import { classifyText, extractAppointment, extractBill, parseSource } from './parser.js';

// Test classification
test('Parser: classifies appointment emails correctly', () => {
  const appointmentText = `
    Your appointment is scheduled for:
    Date: Monday, October 14, 2025
    Time: 2:30 PM
    Location: Valley Medical Center
  `;

  const result = classifyText(appointmentText);

  assert.strictEqual(result.type, 'appointment');
  assert.ok(result.confidence > 0.7, 'Confidence should be > 70%');
});

test('Parser: classifies bill emails correctly', () => {
  const billText = `
    Medical Bill - Account Statement

    Amount Due: $145.50
    Due Date: October 25, 2025

    Pay online at: https://billing.example.com/pay
  `;

  const result = classifyText(billText);

  assert.strictEqual(result.type, 'bill');
  assert.ok(result.confidence > 0.7, 'Confidence should be > 70%');
});

test('Parser: overrides to bill when monetary signals present', () => {
  const text = `Here is your balance.
    Total Due $245.10
    Payment due on 05/01/2026.
  `;
  const result = classifyText(text);
  assert.strictEqual(result.type, 'bill');
});

test('Parser: classifies noise correctly', () => {
  const noiseText = `
    Hello! Just wanted to say hi and see how you're doing.
    Hope all is well!
  `;

  const result = classifyText(noiseText);

  assert.strictEqual(result.type, 'noise');
});

test('Parser: does not misclassify parking fine OCR as bill', () => {
  const parkingFineText = `
    PARKING NOTICE
    TO $300 FINE
    VEHICLE: 7-6887LE
    LOCATION: WEBER ST
    YEARS OF ENFORCEMENT
    THIS IS NOT A BILL
  `;

  const result = classifyText(parkingFineText);

  assert.strictEqual(result.type, 'noise');
  assert.ok(result.confidence < 0.4);
});

test('Parser: still classifies concise bills when structural signals present', () => {
  const conciseBill = `
    STATEMENT
    Amount Due $75.00
    Pay by 11/05/2025
    Account Number 12345
    Pay online at https://example.org/pay
  `;

  const result = classifyText(conciseBill);

  assert.strictEqual(result.type, 'bill');
  assert.ok(result.confidence >= 0.5);
});

// Test appointment extraction
test('Parser: extracts appointment data correctly', () => {
  const text = `
    Your appointment is scheduled for:
    Date: Monday, October 14, 2025
    Time: 2:30 PM
    Location: Valley Medical Center, 123 Main St
    Please arrive 15 minutes early
  `;
  const subject = 'Appointment Reminder';

  const appointment = extractAppointment(text, subject);

  assert.ok(appointment.startLocal, 'Should have start time');
  assert.ok(appointment.endLocal, 'Should have end time');
  assert.strictEqual(appointment.summary, 'Appointment Reminder');
  assert.ok(appointment.location && appointment.location.includes('Valley Medical'), 'Should extract location');
  assert.ok(appointment.prepNote && appointment.prepNote.includes('15 minutes early'), 'Should extract prep note');
});

// Test bill extraction
test('Parser: extracts bill data correctly', () => {
  const text = `
    Medical Bill

    Statement Date: 10/1/2025
    Amount Due: $145.50
    Pay by:
    10/25/2025

    Pay online: https://billing.example.com/pay?account=12345
  `;
  const subject = 'Medical Bill Statement';

  const bill = extractBill(text, subject);

  assert.strictEqual(bill.amount, 145.50, 'Should extract amount in dollars');
  assert.ok(bill.payUrl && bill.payUrl.includes('billing.example.com'), 'Should extract payment URL');
  assert.strictEqual(bill.dueDate, '2025-10-25', 'Should parse due date');
  assert.strictEqual(bill.status, 'todo');
});

test('Parser: extracts realistic bill fields from OCR text', () => {
  const text = `
    ALINA HEALTH HOSPITAL STATEMENT
    STATEMENT DATE 03/28/2013
    PLEASE PAY THIS AMOUNT $419.07
    DATE DUE
    04/18/2013
    TOTAL CHARGES $654.80
    BALANCE: $419.07
    PAY ONLINE AT HTTPS://WWW.ALINAHEALTH.ORG/PAYHOSPITALBILL
  `;
  const bill = extractBill(text, 'Hospital Statement');
  assert.strictEqual(bill.amount, 419.07);
  assert.strictEqual(bill.dueDate, '2013-04-18');
  assert.strictEqual(bill.statementDate, '2013-03-28');
});

test('Parser: parseSource marks overdue bills', () => {
  const source = {
    id: 99,
    recipientId: 1,
    kind: 'upload' as const,
    externalId: null,
    sender: null,
    subject: 'Past due statement',
    shortExcerpt: 'Balance due $419.07',
    storageKey: null,
    createdAt: new Date()
  };

  const fullText = `
    PLEASE PAY THIS AMOUNT $419.07
    DATE DUE 04/18/2013
  `;

  const result = parseSource(source, fullText);

  assert.strictEqual(result.classification.type, 'bill');
  assert.strictEqual(result.billOverdue, true);
});

// Test full parse flow
test('Parser: parseSource creates correct structure for appointment', () => {
  const source = {
    id: 1,
    recipientId: 1,
    kind: 'email' as const,
    externalId: null,
    sender: null,
    subject: 'Appointment Reminder - Dr. Smith',
    shortExcerpt: `
      Your appointment is scheduled for:
      Date: Monday, October 14, 2025
      Time: 2:30 PM
      Location: Valley Medical Center
    `,
    storageKey: null,
    createdAt: new Date()
  };

  const result = parseSource(source);

  assert.strictEqual(result.classification.type, 'appointment');
  assert.ok(result.appointmentData, 'Should have appointment data');
  assert.strictEqual(result.billData, null, 'Should not have bill data');
  assert.strictEqual(result.billOverdue, false);
});

test('Parser: parseSource creates correct structure for bill', () => {
  const source = {
    id: 2,
    recipientId: 1,
    kind: 'email' as const,
    externalId: null,
    sender: null,
    subject: 'Medical Bill Statement',
    shortExcerpt: `
      Amount Due: $145.50
      Due Date: October 25, 2025
      Pay online at: https://billing.example.com/pay
    `,
    storageKey: null,
    createdAt: new Date()
  };

  const result = parseSource(source);

  assert.strictEqual(result.classification.type, 'bill');
  assert.ok(result.billData, 'Should have bill data');
  assert.strictEqual(result.appointmentData, null, 'Should not have appointment data');
  assert.strictEqual(result.billOverdue, false);
});

test('Parser: prefers full text when provided', () => {
  const source = {
    id: 3,
    recipientId: 1,
    kind: 'upload' as const,
    externalId: null,
    sender: null,
    subject: 'Bill Snapshot',
    shortExcerpt: 'Amount Due: $--',
    storageKey: null,
    createdAt: new Date()
  };

  const fullText = `
    City Hospital Billing Statement
    Statement Date: September 20, 2125
    Amount Due: $240.75
    Pay by: October 5, 2125
  `;

  const result = parseSource(source, fullText);

  assert.strictEqual(result.classification.type, 'bill');
  assert.ok(result.billData);
  assert.strictEqual(result.billData?.amount, 240.75);
  assert.strictEqual(result.billData?.dueDate, '2125-10-05');
  assert.strictEqual(result.billOverdue, false);
});
