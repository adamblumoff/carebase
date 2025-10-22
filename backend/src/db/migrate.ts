import '../env.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrate(): Promise<void> {
  try {
    console.log('Running database migrations...');

    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');

    await db.query(schema);

    console.log('✓ Database migrations completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('✗ Migration failed:', error);
    process.exit(1);
  }
}

migrate();
