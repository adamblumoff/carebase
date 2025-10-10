import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from root directory
const rootEnvPath = join(__dirname, '..', '.env.local');

if (existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
  console.log('📝 Loaded .env.local from root (local development)');
} else {
  console.log('☁️  Using system environment variables (production)');
}
