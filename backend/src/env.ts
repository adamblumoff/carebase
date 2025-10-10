/**
 * Load environment variables FIRST before anything else
 * This file must be imported before any other modules
 */
import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try root first, then backend directory
const envPath = existsSync(join(__dirname, '../../.env.local'))
  ? join(__dirname, '../../.env.local')
  : join(__dirname, '../.env.local');

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
  console.log('📝 Loaded environment from', envPath);
} else {
  console.warn('⚠️  No .env.local file found at', envPath);
}

// Verify critical env vars
if (!process.env.GOOGLE_CLIENT_ID) {
  console.error('❌ Missing GOOGLE_CLIENT_ID in environment');
}
if (!process.env.DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL in environment');
}
