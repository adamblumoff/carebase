import pg from 'pg';
import type { ConnectionOptions as TlsConnectionOptions } from 'tls';

type PgSslConfig = pg.ConnectionConfig['ssl'];

function normalizeFlag(value: string | undefined): string {
  return value ? value.toLowerCase().trim() : '';
}

function readCertificateFromEnv(): string | undefined {
  const inline = process.env.DATABASE_SSL_CA;
  if (inline && inline.trim().length > 0) {
    return inline.replace(/\\n/g, '\n');
  }

  const base64 = process.env.DATABASE_SSL_CA_BASE64;
  if (base64 && base64.trim().length > 0) {
    try {
      return Buffer.from(base64.trim(), 'base64').toString('utf8');
    } catch (error) {
      throw new Error(
        `Failed to decode DATABASE_SSL_CA_BASE64 as base64: ${(error as Error).message}`
      );
    }
  }

  return undefined;
}

export function resolveSslConfig(): PgSslConfig {
  const mode = normalizeFlag(process.env.DATABASE_SSL);
  const disable = ['disable', 'disabled', 'off', 'false', '0'].includes(mode);
  if (disable) {
    return false;
  }

  const enable =
    ['require', 'required', 'verify-full', 'verify_ca', 'true', '1', 'on'].includes(mode) ||
    (!mode && process.env.NODE_ENV === 'production');

  if (!enable) {
    return false;
  }

  const rejectUnauthorized = normalizeFlag(process.env.DATABASE_SSL_REJECT_UNAUTHORIZED) !== 'false';
  const caRaw = readCertificateFromEnv();

  if (rejectUnauthorized && process.env.NODE_ENV === 'production' && !caRaw) {
    throw new Error(
      'DATABASE_SSL_CA (or DATABASE_SSL_CA_BASE64) must be provided when TLS verification is enabled in production'
    );
  }

  const sslConfig: TlsConnectionOptions = {
    rejectUnauthorized
  };

  if (caRaw) {
    sslConfig.ca = caRaw;
  }

  return sslConfig;
}

export const databaseSslConfig = resolveSslConfig();
