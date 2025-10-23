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
const rootDir = join(__dirname, '../../');
const backendDir = join(__dirname, '../');

const envName = (process.env.CAREBASE_ENV || process.env.NODE_ENV || 'development').trim();
const candidateFiles = [
  `.env.${envName}`,
  `.env.${envName}.local`
];

const searchDirs = [rootDir, backendDir];
const loadedFiles: string[] = [];

for (const candidate of candidateFiles) {
  for (const dir of searchDirs) {
    const fullPath = join(dir, candidate);
    if (existsSync(fullPath) && !loadedFiles.includes(fullPath)) {
      dotenv.config({ path: fullPath, override: true });
      loadedFiles.push(fullPath);
    }
  }
}

if (loadedFiles.length > 0) {
  console.log('📝 Loaded environment files:', loadedFiles.join(', '));
} else {
  console.warn('⚠️  No environment files found. Expected one of', candidateFiles.join(', '));
}

const isTestEnv = process.env.NODE_ENV === 'test';

// Provide deterministic secrets during test runs to keep suites hermetic.
if (isTestEnv) {
  process.env.GOOGLE_AUTH_STATE_SECRET ??= 'test-google-state-secret';
  process.env.GOOGLE_CREDENTIALS_ENCRYPTION_KEY ??= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
}

interface RequiredSetting {
  key: string;
  description: string;
  allowEmpty?: boolean;
}

const requiredSettings: RequiredSetting[] = [
  { key: 'DATABASE_URL', description: 'Postgres connection string' },
  { key: 'GOOGLE_AUTH_STATE_SECRET', description: 'Google OAuth state signing secret' },
  { key: 'GOOGLE_CREDENTIALS_ENCRYPTION_KEY', description: 'AES key for Google credential encryption' },
  { key: 'GOOGLE_CLIENT_ID', description: 'Google OAuth client identifier' },
  { key: 'GOOGLE_CLIENT_SECRET', description: 'Google OAuth client secret' }
];

const missing = requiredSettings
  .filter(({ key, allowEmpty }) => {
    const value = process.env[key];
    if (allowEmpty) {
      return value === undefined;
    }
    return !value;
  })
  .map(({ key, description }) => `${key} (${description})`);

if (missing.length > 0) {
  console.error('❌ Missing required environment variables:\n  -', missing.join('\n  - '));
  console.error('Set the variables above before starting the backend.');
  process.exit(1);
}
