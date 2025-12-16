import { config } from 'dotenv';
import { Pool } from 'pg';

config({ path: '.env' });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is missing in .env');
}

const sanitizeDatabaseUrl = (raw: string) => {
  try {
    const url = new URL(raw);
    const user = url.username ? `${url.username}@` : '';
    const host = url.host;
    const db = url.pathname.replace(/^\//, '');
    return `${url.protocol}//${user}${host}/${db}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
};

async function main() {
  console.log(`Target DB: ${sanitizeDatabaseUrl(databaseUrl)}`);

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const beforeTasks = await pool.query<{ count: string }>(
      'select count(*)::text as count from tasks'
    );
    const beforeAssignments = await pool.query<{ count: string }>(
      'select count(*)::text as count from task_assignments'
    );

    console.log(
      `Before: tasks=${beforeTasks.rows[0]?.count ?? '0'} task_assignments=${beforeAssignments.rows[0]?.count ?? '0'}`
    );

    await pool.query('begin');
    await pool.query('delete from task_assignments');
    await pool.query('delete from tasks');
    await pool.query('commit');

    const afterTasks = await pool.query<{ count: string }>(
      'select count(*)::text as count from tasks'
    );
    const afterAssignments = await pool.query<{ count: string }>(
      'select count(*)::text as count from task_assignments'
    );

    console.log(
      `After:  tasks=${afterTasks.rows[0]?.count ?? '0'} task_assignments=${afterAssignments.rows[0]?.count ?? '0'}`
    );
  } catch (err) {
    try {
      await pool.query('rollback');
    } catch {
      // ignore
    }
    throw err;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
