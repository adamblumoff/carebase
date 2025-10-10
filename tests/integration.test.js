import { test } from 'node:test';
import assert from 'node:assert';
import db from '../src/db/client.js';
import {
  createUser,
  createRecipient,
  createSource,
  deleteUser,
  getUpcomingAppointments,
  getUpcomingBills
} from '../src/db/queries.js';
import { parseSource } from '../src/services/parser.js';
import { createAppointment, createBill, createItem } from '../src/db/queries.js';

// Cleanup helper
async function cleanup(userId) {
  if (userId) {
    await deleteUser(userId);
  }
}

test('Integration: Full appointment flow from email to database', async () => {
  let testUser = null;

  try {
    // 1. Create user and recipient
    testUser = await createUser('test@example.com', 'test-google-id-' + Date.now());
    const recipient = await createRecipient(testUser.id, 'Test Recipient');

    // 2. Simulate incoming email (appointment)
    const appointmentEmail = {
      externalId: 'test-msg-' + Date.now(),
      sender: 'clinic@example.com',
      subject: 'Appointment Reminder - Dr. Smith',
      shortExcerpt: `
        Your appointment is scheduled for:
        Date: Monday, October 14, 2025
        Time: 2:30 PM
        Location: Valley Medical Center, 123 Main St
        Please arrive 15 minutes early
      `,
      storageKey: null
    };

    const source = await createSource(recipient.id, 'email', appointmentEmail);

    // 3. Parse and create item
    const parsed = parseSource(source);

    assert.strictEqual(parsed.classification.type, 'appointment', 'Should classify as appointment');

    const item = await createItem(
      recipient.id,
      source.id,
      parsed.classification.type,
      parsed.classification.confidence
    );

    // 4. Create appointment
    const appointment = await createAppointment(item.id, parsed.appointmentData);

    assert.ok(appointment.id, 'Should create appointment');
    assert.ok(appointment.ics_token, 'Should have ICS token');
    assert.strictEqual(appointment.summary, 'Appointment Reminder - Dr. Smith');

    // 5. Verify appointment shows in upcoming list
    const startDate = new Date('2025-10-01');
    const endDate = new Date('2025-10-31');
    const upcomingAppointments = await getUpcomingAppointments(
      recipient.id,
      startDate.toISOString(),
      endDate.toISOString()
    );

    assert.ok(upcomingAppointments.length > 0, 'Should have upcoming appointments');
    assert.ok(
      upcomingAppointments.some(a => a.id === appointment.id),
      'Should include our test appointment'
    );

  } finally {
    await cleanup(testUser?.id);
  }
});

test('Integration: Full bill flow from email to database', async () => {
  let testUser = null;

  try {
    // 1. Create user and recipient
    testUser = await createUser('test-bill@example.com', 'test-google-id-bill-' + Date.now());
    const recipient = await createRecipient(testUser.id, 'Test Recipient');

    // 2. Simulate incoming email (bill)
    const billEmail = {
      externalId: 'test-bill-msg-' + Date.now(),
      sender: 'billing@hospital.com',
      subject: 'Medical Bill Statement',
      shortExcerpt: `
        Medical Bill

        Statement Date: October 1, 2025
        Amount Due: $145.50
        Due Date: October 25, 2025

        Pay online at: https://billing.example.com/pay?account=12345
      `,
      storageKey: null
    };

    const source = await createSource(recipient.id, 'email', billEmail);

    // 3. Parse and create item
    const parsed = parseSource(source);

    assert.strictEqual(parsed.classification.type, 'bill', 'Should classify as bill');

    const item = await createItem(
      recipient.id,
      source.id,
      parsed.classification.type,
      parsed.classification.confidence
    );

    // 4. Create bill
    const bill = await createBill(item.id, parsed.billData);

    assert.ok(bill.id, 'Should create bill');
    assert.strictEqual(bill.amount_cents, 14550, 'Should extract amount correctly');
    assert.strictEqual(bill.status, 'todo', 'Should default to todo status');

    // 5. Verify bill shows in upcoming list
    const startDate = new Date('2025-10-01');
    const endDate = new Date('2025-10-31');
    const upcomingBills = await getUpcomingBills(
      recipient.id,
      startDate.toISOString(),
      endDate.toISOString()
    );

    assert.ok(upcomingBills.length > 0, 'Should have upcoming bills');
    assert.ok(
      upcomingBills.some(b => b.id === bill.id),
      'Should include our test bill'
    );

  } finally {
    await cleanup(testUser?.id);
  }
});

test('Integration: User creation generates forwarding address and tokens', async () => {
  let testUser = null;

  try {
    testUser = await createUser('token-test@example.com', 'test-google-id-tokens-' + Date.now());

    assert.ok(testUser.forwarding_address, 'Should have forwarding address');
    assert.ok(testUser.forwarding_address.includes('@'), 'Forwarding address should be email format');
    assert.ok(testUser.plan_secret, 'Should have plan secret token');
    assert.strictEqual(testUser.plan_secret.length, 64, 'Plan secret should be 64 chars (32 bytes hex)');

    const recipient = await createRecipient(testUser.id, 'Test Recipient');
    assert.ok(recipient.id, 'Should create recipient');

  } finally {
    await cleanup(testUser?.id);
  }
});

test('Integration: Account deletion cascades to all related records', async () => {
  let testUser = null;

  try {
    // Create full data structure
    testUser = await createUser('cascade-test@example.com', 'test-google-id-cascade-' + Date.now());
    const recipient = await createRecipient(testUser.id, 'Test Recipient');

    const source = await createSource(recipient.id, 'email', {
      externalId: 'test-cascade-' + Date.now(),
      sender: 'test@example.com',
      subject: 'Test',
      shortExcerpt: 'Test message',
      storageKey: null
    });

    const item = await createItem(recipient.id, source.id, 'noise', 0.5);

    // Verify records exist
    const recipientCheck = await db.query('SELECT * FROM recipients WHERE user_id = $1', [testUser.id]);
    assert.strictEqual(recipientCheck.rows.length, 1, 'Recipient should exist');

    const sourceCheck = await db.query('SELECT * FROM sources WHERE recipient_id = $1', [recipient.id]);
    assert.strictEqual(sourceCheck.rows.length, 1, 'Source should exist');

    const itemCheck = await db.query('SELECT * FROM items WHERE recipient_id = $1', [recipient.id]);
    assert.strictEqual(itemCheck.rows.length, 1, 'Item should exist');

    // Delete user
    await deleteUser(testUser.id);

    // Verify cascade deletion
    const userCheck = await db.query('SELECT * FROM users WHERE id = $1', [testUser.id]);
    assert.strictEqual(userCheck.rows.length, 0, 'User should be deleted');

    const recipientCascade = await db.query('SELECT * FROM recipients WHERE user_id = $1', [testUser.id]);
    assert.strictEqual(recipientCascade.rows.length, 0, 'Recipient should be cascaded');

    const sourceCascade = await db.query('SELECT * FROM sources WHERE recipient_id = $1', [recipient.id]);
    assert.strictEqual(sourceCascade.rows.length, 0, 'Source should be cascaded');

    const itemCascade = await db.query('SELECT * FROM items WHERE recipient_id = $1', [recipient.id]);
    assert.strictEqual(itemCascade.rows.length, 0, 'Item should be cascaded');

    // Don't cleanup since we already deleted
    testUser = null;

  } finally {
    await cleanup(testUser?.id);
  }
});
