#!/usr/bin/env node
import { existsSync, copyFileSync, renameSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');
const mobileDir = join(root, 'mobile');
const devFile = join(mobileDir, '.env.development.local');
const prodFile = join(mobileDir, '.env.production.local');
const activeFile = join(mobileDir, '.env.local');
const backupDev = join(mobileDir, '.env.development.local.backup');
const legacyBackup = join(mobileDir, '.env.development.local.bak');

function ensureExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label} at ${path}. Create it first.`);
  }
}

const mode = process.argv[2];

if (!mode || !['prod', 'dev'].includes(mode)) {
  console.error('Usage: npm run env:mobile:<prod|dev>');
  process.exit(1);
}

try {
  if (mode === 'prod') {
    ensureExists(prodFile, '.env.production.local');
    // Normalize any legacy backup filenames
    if (existsSync(legacyBackup) && !existsSync(backupDev)) {
      renameSync(legacyBackup, backupDev);
    }
    if (existsSync(devFile) && !existsSync(backupDev)) {
      renameSync(devFile, backupDev);
    }
    copyFileSync(prodFile, activeFile);
    console.log('📱 Expo env set to production (.env.production.local -> .env.local)');
    console.log('➡️  Run "npx expo start --clear" to apply.');
  } else {
    if (existsSync(backupDev)) {
      renameSync(backupDev, devFile);
    } else if (existsSync(legacyBackup)) {
      renameSync(legacyBackup, devFile);
    }
    ensureExists(devFile, '.env.development.local');
    copyFileSync(devFile, activeFile);
    console.log('📱 Expo env set to development (.env.development.local -> .env.local)');
    console.log('➡️  Run "npx expo start --clear" to apply.');
  }
} catch (error) {
  console.error('Failed to swap Expo env:', error.message);
  process.exit(1);
}
