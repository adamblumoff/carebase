import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STORAGE_DIR = join(__dirname, '../../uploads');

// Ensure storage directory exists
async function ensureStorageDir(): Promise<void> {
  try {
    await mkdir(STORAGE_DIR, { recursive: true });
  } catch (error: any) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Store text content to filesystem
 * @param content - Text content to store
 * @returns Storage key
 */
export async function storeText(content: string): Promise<string> {
  await ensureStorageDir();

  const key = crypto.randomBytes(16).toString('hex');
  const filePath = join(STORAGE_DIR, `${key}.txt`);

  await writeFile(filePath, content, 'utf8');
  return key;
}

/**
 * Retrieve text content from filesystem
 * @param key - Storage key
 * @returns Text content
 */
export async function retrieveText(key: string): Promise<string> {
  const filePath = join(STORAGE_DIR, `${key}.txt`);
  return await readFile(filePath, 'utf8');
}

/**
 * Store binary file to filesystem
 * @param buffer - File buffer
 * @param ext - File extension
 * @returns Storage key
 */
export async function storeFile(buffer: Buffer, ext: string = 'bin'): Promise<string> {
  await ensureStorageDir();

  const key = crypto.randomBytes(16).toString('hex');
  const filePath = join(STORAGE_DIR, `${key}.${ext}`);

  await writeFile(filePath, buffer);
  return key;
}

/**
 * Retrieve file from filesystem
 * @param key - Storage key
 * @returns File buffer
 */
export async function retrieveFile(key: string): Promise<Buffer> {
  const filePath = join(STORAGE_DIR, key);
  return await readFile(filePath);
}
