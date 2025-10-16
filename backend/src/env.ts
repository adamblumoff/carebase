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

// Verify critical env vars
if (!process.env.GOOGLE_CLIENT_ID) {
  console.error('❌ Missing GOOGLE_CLIENT_ID in environment');
}
if (!process.env.DATABASE_URL) {
  console.error('❌ Missing DATABASE_URL in environment');
}
