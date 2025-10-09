import { writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const STORAGE_DIR = join(__dirname, '../../uploads');

// Ensure storage directory exists
async function ensureStorageDir() {
  try {
    await mkdir(STORAGE_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Store text content to filesystem
 * @param {string} content - Text content to store
 * @returns {Promise<string>} - Storage key
 */
export async function storeText(content) {
  await ensureStorageDir();

  const key = crypto.randomBytes(16).toString('hex');
  const filePath = join(STORAGE_DIR, `${key}.txt`);

  await writeFile(filePath, content, 'utf8');
  return key;
}

/**
 * Retrieve text content from filesystem
 * @param {string} key - Storage key
 * @returns {Promise<string>} - Text content
 */
export async function retrieveText(key) {
  const filePath = join(STORAGE_DIR, `${key}.txt`);
  return await readFile(filePath, 'utf8');
}

/**
 * Store binary file to filesystem
 * @param {Buffer} buffer - File buffer
 * @param {string} ext - File extension
 * @returns {Promise<string>} - Storage key
 */
export async function storeFile(buffer, ext = 'bin') {
  await ensureStorageDir();

  const key = crypto.randomBytes(16).toString('hex');
  const filePath = join(STORAGE_DIR, `${key}.${ext}`);

  await writeFile(filePath, buffer);
  return key;
}

/**
 * Retrieve file from filesystem
 * @param {string} key - Storage key
 * @returns {Promise<Buffer>} - File buffer
 */
export async function retrieveFile(key) {
  const filePath = join(STORAGE_DIR, key);
  return await readFile(filePath);
}
