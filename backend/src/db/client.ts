import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
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
  console.log('Executed query', { text: text.substring(0, 50), duration, rows: res.rowCount });
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
