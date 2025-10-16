import type { User } from '@carebase/shared';
import { db } from './shared.js';
import { generateForwardingAddress, generateToken } from './shared.js';

interface UserRow {
  id: number;
  email: string;
  google_id: string;
  forwarding_address: string;
  plan_secret: string;
  plan_version: number;
  plan_updated_at: Date;
  created_at: Date;
}

export function userRowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    googleId: row.google_id,
    forwardingAddress: row.forwarding_address,
    planSecret: row.plan_secret,
    planVersion: row.plan_version ?? 0,
    planUpdatedAt: row.plan_updated_at,
    createdAt: row.created_at
  };
}

export async function createUser(email: string, googleId: string): Promise<User> {
  const planSecret = generateToken(32);
  const result = await db.query(
    `INSERT INTO users (email, google_id, forwarding_address, plan_secret)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email, googleId, 'temp', planSecret]
  );

  const user = userRowToUser(result.rows[0] as UserRow);

  const forwardingAddress = generateForwardingAddress(user.id);
  await db.query(
    'UPDATE users SET forwarding_address = $1 WHERE id = $2',
    [forwardingAddress, user.id]
  );

  user.forwardingAddress = forwardingAddress;
  return user;
}

export async function findUserByGoogleId(googleId: string): Promise<User | undefined> {
  const result = await db.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
  return result.rows[0] ? userRowToUser(result.rows[0] as UserRow) : undefined;
}

export async function findUserByEmail(email: string): Promise<User | undefined> {
  const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] ? userRowToUser(result.rows[0] as UserRow) : undefined;
}

export async function findUserById(id: number): Promise<User | undefined> {
  const result = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return result.rows[0] ? userRowToUser(result.rows[0] as UserRow) : undefined;
}

export async function deleteUser(userId: number): Promise<void> {
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
}
