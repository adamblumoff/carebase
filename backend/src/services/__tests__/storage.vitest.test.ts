import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { join } from 'path';
import { rm, readFile } from 'fs/promises';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {
  storeText,
  retrieveText,
  storeFile,
  retrieveFile
} from '../storage.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const STORAGE_DIR = join(__dirname, '../../../uploads');

afterEach(async () => {
  vi.restoreAllMocks();
  // clean uploads directory between tests to avoid bleed
  await rm(STORAGE_DIR, { recursive: true, force: true });
});

describe('storage service', () => {
  it('stores and retrieves text content', async () => {
    vi.spyOn(crypto, 'randomBytes').mockReturnValueOnce(Buffer.from('textkey-textkey'));
    const key = await storeText('hello world');
    expect(key).toMatch(/^[a-f0-9]+$/);

    const roundTrip = await retrieveText(key);
    expect(roundTrip).toBe('hello world');
  });

  it('stores files with sanitized extension and retrieves by bare key', async () => {
    vi.spyOn(crypto, 'randomBytes').mockReturnValueOnce(Buffer.from('filekey-filekey'));
    const key = await storeFile(Buffer.from('binary'), '.JPG');
    expect(key).toMatch(/^[a-f0-9]+$/);

    const buffer = await retrieveFile(key);
    expect(buffer.toString()).toBe('binary');

    const storedPath = join(STORAGE_DIR, `${key}.jpg`);
    const raw = await readFile(storedPath, 'utf8');
    expect(raw).toBe('binary');
  });

  it('rejects unsafe storage keys', async () => {
    vi.spyOn(crypto, 'randomBytes').mockReturnValue(Buffer.from('bin-key-bin-key'));
    await expect(retrieveFile('../evil')).rejects.toThrow('Invalid storage key');
    await expect(retrieveText('..')).rejects.toThrow('Invalid storage key');
  });
});
