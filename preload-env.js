import dotenv from 'dotenv';
import { existsSync } from 'fs';

// Load environment variables before anything else
if (existsSync('.env.local')) {
  dotenv.config({ path: '.env.local' });
  console.log('📝 Loaded .env.local (local development)');
} else {
  console.log('☁️  Using system environment variables (production)');
}
