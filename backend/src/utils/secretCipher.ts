import crypto from 'crypto';

const rawKey =
  process.env.GOOGLE_CREDENTIALS_ENCRYPTION_KEY ??
  (process.env.NODE_ENV === 'test' ? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' : undefined);

if (!rawKey) {
  throw new Error('GOOGLE_CREDENTIALS_ENCRYPTION_KEY must be configured');
}

function decodeKey(value: string): Buffer {
  const trimmed = value.trim();

  const tryDecode = (input: string, encoding: BufferEncoding): Buffer | null => {
    try {
      const result = Buffer.from(input, encoding);
      return result.length === 32 ? result : null;
    } catch {
      return null;
    }
  };

  const base64 = tryDecode(trimmed, 'base64');
  if (base64) {
    return base64;
  }

  const hex = tryDecode(trimmed, 'hex');
  if (hex) {
    return hex;
  }

  throw new Error('GOOGLE_CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes (base64 or hex)');
}

const encryptionKey = decodeKey(rawKey);

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit IV for GCM

export function encryptSecret(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64')
  ].join('.');
}

export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) {
    return null;
  }

  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivPart, authTagPart, dataPart] = parts;

  const iv = Buffer.from(ivPart, 'base64');
  const authTag = Buffer.from(authTagPart, 'base64');
  const encrypted = Buffer.from(dataPart, 'base64');

  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
