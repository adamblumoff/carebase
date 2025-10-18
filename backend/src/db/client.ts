import pg from 'pg';
import type { ConnectionOptions as TlsConnectionOptions } from 'tls';

const { Pool } = pg;

type PgSslConfig = pg.ConnectionConfig['ssl'];

function normalizeFlag(value: string | undefined): string {
  return value ? value.toLowerCase().trim() : '';
}

function resolveSslConfig(): PgSslConfig {
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
  const caRaw = process.env.DATABASE_SSL_CA ? process.env.DATABASE_SSL_CA.replace(/\\n/g, '\n') : undefined;

  if (rejectUnauthorized && process.env.NODE_ENV === 'production' && !caRaw) {
    throw new Error('DATABASE_SSL_CA must be provided when TLS verification is enabled in production');
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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: databaseSslConfig
});

const debugSql = normalizeFlag(process.env.DEBUG_SQL) === 'true';

// Test connection
pool.on('connect', () => {
  if (debugSql) {
    console.log('Connected to PostgreSQL database');
  }
});

pool.on('error', (err: Error) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Execute a SQL query
 * @param text - SQL query
 * @param params - Query parameters
 * @returns Query result
 */
export async function query(text: string, params?: any[]): Promise<pg.QueryResult> {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (debugSql) {
    console.log('Executed query', {
      statement: text.replace(/\s+/g, ' ').trim().slice(0, 200),
      duration,
      rows: res.rowCount
    });
  }
  return res;
}

/**
 * Get a client from the pool for transactions
 * @returns Pool client
 */
export async function getClient(): Promise<pg.PoolClient> {
  const client = await pool.getClient();
  const originalQuery = client.query;
  const originalRelease = client.release;

  // Log queries
  client.query = ((...args: any[]) => {
    (client as any).lastQuery = args;
    return originalQuery.apply(client, args);
  }) as any;

  // Track release
  client.release = (() => {
    client.query = originalQuery;
    client.release = originalRelease;
    return client.release();
  }) as any;

  return client;
}

/**
 * End the pool (for cleanup in tests)
 * @returns Pool end
 */
export async function end(): Promise<void> {
  return pool.end();
}

export default { query, getClient, pool, end };
