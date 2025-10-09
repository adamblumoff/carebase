/**
 * Add test data to see the app in action
 * Run with: node scripts/add-test-data.js
 */

import db from '../src/db/client.js';
import {
  findUserByEmail,
  findRecipientsByUserId,
  createSource,
  createItem,
  createAppointment,
  createBill,
  createAuditLog
} from '../src/db/queries.js';

async function addTestData() {
  try {
    console.log('Adding test data...\n');

    // Get the first user (you, after signing in)
    const result = await db.query('SELECT * FROM users ORDER BY created_at ASC LIMIT 1');

    if (result.rows.length === 0) {
      console.error('❌ No users found. Please sign in to the app first at http://localhost:3000');
      process.exit(1);
    }

    const user = result.rows[0];
    console.log(`✓ Found user: ${user.email}`);

    // Get their recipient
    const recipients = await findRecipientsByUserId(user.id);
    if (recipients.length === 0) {
      console.error('❌ No recipient found');
      process.exit(1);
    }

    const recipient = recipients[0];
    console.log(`✓ Found recipient: ${recipient.display_name}\n`);

    // Create test appointment 1 - Doctor visit
    console.log('Creating test appointment 1: Doctor checkup...');
    const apptSource1 = await createSource(recipient.id, 'email', {
      externalId: 'test-appt-1',
      sender: 'appointments@healthcare.com',
      subject: 'Upcoming Appointment - Dr. Johnson',
      shortExcerpt: 'Your annual checkup with Dr. Johnson is scheduled.',
      storageKey: null
    });

    const apptItem1 = await createItem(recipient.id, apptSource1.id, 'appointment', 0.95);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(14, 30, 0, 0);

    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(15, 30, 0, 0);

    await createAppointment(apptItem1.id, {
      startLocal: tomorrow.toISOString(),
      endLocal: tomorrowEnd.toISOString(),
      location: 'City Medical Center, 123 Health St, Suite 200',
      prepNote: 'Please arrive 15 minutes early. Bring your insurance card and ID.',
      summary: 'Annual Checkup with Dr. Johnson'
    });

    await createAuditLog(apptItem1.id, 'test_data_created', {
      type: 'appointment',
      confidence: 0.95
    });

    console.log('✓ Created appointment for tomorrow at 2:30 PM\n');

    // Create test appointment 2 - Physical therapy
    console.log('Creating test appointment 2: Physical therapy...');
    const apptSource2 = await createSource(recipient.id, 'email', {
      externalId: 'test-appt-2',
      sender: 'pt@therapycenter.com',
      subject: 'PT Session Reminder',
      shortExcerpt: 'Your physical therapy session is coming up.',
      storageKey: null
    });

    const apptItem2 = await createItem(recipient.id, apptSource2.id, 'appointment', 0.88);

    const dayAfterTomorrow = new Date();
    dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 3);
    dayAfterTomorrow.setHours(10, 0, 0, 0);

    const dayAfterTomorrowEnd = new Date(dayAfterTomorrow);
    dayAfterTomorrowEnd.setHours(11, 0, 0, 0);

    await createAppointment(apptItem2.id, {
      startLocal: dayAfterTomorrow.toISOString(),
      endLocal: dayAfterTomorrowEnd.toISOString(),
      location: 'North Side Therapy Center, 456 Wellness Ave',
      prepNote: 'Wear comfortable clothing. Bring water bottle.',
      summary: 'Physical Therapy Session'
    });

    await createAuditLog(apptItem2.id, 'test_data_created', {
      type: 'appointment',
      confidence: 0.88
    });

    console.log('✓ Created appointment for 3 days from now at 10:00 AM\n');

    // Create test bill 1 - Doctor bill
    console.log('Creating test bill 1: Doctor visit bill...');
    const billSource1 = await createSource(recipient.id, 'email', {
      externalId: 'test-bill-1',
      sender: 'billing@healthcare.com',
      subject: 'Statement Available - Amount Due $125.50',
      shortExcerpt: 'Your statement for recent visit is ready.',
      storageKey: null
    });

    const billItem1 = await createItem(recipient.id, billSource1.id, 'bill', 0.92);

    const dueDate1 = new Date();
    dueDate1.setDate(dueDate1.getDate() + 15);

    await createBill(billItem1.id, {
      statementDate: new Date().toISOString().split('T')[0],
      amountCents: 12550, // $125.50
      dueDate: dueDate1.toISOString().split('T')[0],
      payUrl: 'https://portal.healthcarepayments.com/pay/12345',
      status: 'todo'
    });

    await createAuditLog(billItem1.id, 'test_data_created', {
      type: 'bill',
      confidence: 0.92
    });

    console.log('✓ Created bill for $125.50 due in 15 days\n');

    // Create test bill 2 - Pharmacy
    console.log('Creating test bill 2: Pharmacy bill...');
    const billSource2 = await createSource(recipient.id, 'email', {
      externalId: 'test-bill-2',
      sender: 'receipts@pharmacy.com',
      subject: 'Prescription Payment Due',
      shortExcerpt: 'Your prescription copay is due.',
      storageKey: null
    });

    const billItem2 = await createItem(recipient.id, billSource2.id, 'bill', 0.85);

    const dueDate2 = new Date();
    dueDate2.setDate(dueDate2.getDate() + 5);

    await createBill(billItem2.id, {
      statementDate: new Date().toISOString().split('T')[0],
      amountCents: 3500, // $35.00
      dueDate: dueDate2.toISOString().split('T')[0],
      payUrl: 'https://pharmacy.com/pay',
      status: 'todo'
    });

    await createAuditLog(billItem2.id, 'test_data_created', {
      type: 'bill',
      confidence: 0.85
    });

    console.log('✓ Created bill for $35.00 due in 5 days\n');

    // Create a paid bill for variety
    console.log('Creating test bill 3: Already paid...');
    const billSource3 = await createSource(recipient.id, 'email', {
      externalId: 'test-bill-3',
      sender: 'billing@labcorp.com',
      subject: 'Lab Work Statement',
      shortExcerpt: 'Your lab work statement.',
      storageKey: null
    });

    const billItem3 = await createItem(recipient.id, billSource3.id, 'bill', 0.90);

    await createBill(billItem3.id, {
      statementDate: new Date().toISOString().split('T')[0],
      amountCents: 8900, // $89.00
      dueDate: new Date().toISOString().split('T')[0],
      payUrl: 'https://labcorp.com/pay',
      status: 'paid'
    });

    await createAuditLog(billItem3.id, 'test_data_created', {
      type: 'bill',
      confidence: 0.90
    });

    console.log('✓ Created paid bill for $89.00\n');

    console.log('===========================================');
    console.log('✅ Test data added successfully!');
    console.log('===========================================');
    console.log('\nNow visit: http://localhost:3000/plan');
    console.log('\nYou should see:');
    console.log('  📅 2 upcoming appointments');
    console.log('  💵 3 bills (2 due, 1 paid)');
    console.log('\nTry clicking "Add to Calendar" on appointments!');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error adding test data:', error);
    process.exit(1);
  }
}

addTestData();
