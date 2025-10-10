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

test('Parser: classifies noise correctly', () => {
  const noiseText = `
    Hello! Just wanted to say hi and see how you're doing.
    Hope all is well!
  `;

  const result = classifyText(noiseText);

  assert.strictEqual(result.type, 'noise');
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
    Pay by: 10/25/2025

    Pay online: https://billing.example.com/pay?account=12345
  `;
  const subject = 'Medical Bill Statement';

  const bill = extractBill(text, subject);

  assert.strictEqual(bill.amount, 145.50, 'Should extract amount in dollars');
  assert.ok(bill.payUrl && bill.payUrl.includes('billing.example.com'), 'Should extract payment URL');
  assert.strictEqual(bill.status, 'todo');
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
});
