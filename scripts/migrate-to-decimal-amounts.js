/**
 * Migration script: Convert amount_cents (INTEGER) to amount (DECIMAL)
 * Run with: node --import ./preload-env.js scripts/migrate-to-decimal-amounts.js
 */

import db from '../src/db/client.js';

async function migrate() {
  try {
    console.log('Starting migration: amount_cents (INTEGER) → amount (DECIMAL)...\n');

    // Step 1: Add new amount column
    console.log('Step 1: Adding new amount column (DECIMAL)...');
    await db.query(`
      ALTER TABLE bills
      ADD COLUMN IF NOT EXISTS amount DECIMAL(10, 2)
    `);
    console.log('✓ Added amount column\n');

    // Step 2: Migrate data from amount_cents to amount
    console.log('Step 2: Migrating data from amount_cents to amount...');
    const result = await db.query(`
      UPDATE bills
      SET amount = amount_cents / 100.0
      WHERE amount_cents IS NOT NULL AND amount IS NULL
    `);
    console.log(`✓ Migrated ${result.rowCount} rows\n`);

    // Step 3: Drop old amount_cents column
    console.log('Step 3: Dropping old amount_cents column...');
    await db.query(`
      ALTER TABLE bills
      DROP COLUMN IF EXISTS amount_cents
    `);
    console.log('✓ Dropped amount_cents column\n');

    console.log('===========================================');
    console.log('✅ Migration completed successfully!');
    console.log('===========================================');
    console.log('\nBills table now uses amount (DECIMAL) instead of amount_cents (INTEGER)');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
