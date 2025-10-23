import type { User, UserMfaStatus, UserMfaStatusState } from '@carebase/shared';
import { db } from './shared.js';
import { generateForwardingAddress, generateToken } from './shared.js';

interface UserRow {
  id: number;
  email: string;
  google_id: string | null;
  legacy_google_id: string | null;
  clerk_user_id: string | null;
  password_reset_required: boolean;
  forwarding_address: string;
  plan_secret: string;
  plan_version: number;
  plan_updated_at: Date;
  created_at: Date;
}

interface UserMfaStatusRow {
  user_id: number;
  status: UserMfaStatusState;
  last_transition_at: Date | null;
  grace_expires_at: Date | null;
}

export function userRowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    googleId: row.google_id,
    legacyGoogleId: row.legacy_google_id,
    clerkUserId: row.clerk_user_id,
    passwordResetRequired: row.password_reset_required ?? false,
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
    `INSERT INTO users (email, google_id, legacy_google_id, forwarding_address, plan_secret)
     VALUES ($1, $2, $2, $3, $4)
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

export async function findUserByLegacyGoogleId(googleId: string): Promise<User | undefined> {
  const result = await db.query('SELECT * FROM users WHERE legacy_google_id = $1', [googleId]);
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

export async function findUserByClerkUserId(clerkUserId: string): Promise<User | undefined> {
  const result = await db.query('SELECT * FROM users WHERE clerk_user_id = $1', [clerkUserId]);
  return result.rows[0] ? userRowToUser(result.rows[0] as UserRow) : undefined;
}

export async function setClerkUserId(userId: number, clerkUserId: string): Promise<void> {
  await db.query('UPDATE users SET clerk_user_id = $1 WHERE id = $2', [clerkUserId, userId]);
}

export async function setPasswordResetRequired(userId: number, required: boolean): Promise<void> {
  await db.query('UPDATE users SET password_reset_required = $1 WHERE id = $2', [required, userId]);
}

export async function deleteUser(userId: number): Promise<void> {
  await db.query('DELETE FROM users WHERE id = $1', [userId]);
}

function mapMfaStatusRow(row: UserMfaStatusRow): UserMfaStatus {
  return {
    userId: row.user_id,
    status: row.status,
    lastTransitionAt: row.last_transition_at,
    graceExpiresAt: row.grace_expires_at
  };
}

export async function getUserMfaStatus(userId: number): Promise<UserMfaStatus | undefined> {
  const result = await db.query('SELECT * FROM users_mfa_status WHERE user_id = $1', [userId]);
  return result.rows[0] ? mapMfaStatusRow(result.rows[0] as UserMfaStatusRow) : undefined;
}

export async function upsertUserMfaStatus(
  userId: number,
  status: UserMfaStatusState,
  graceExpiresAt: Date | null = null
): Promise<UserMfaStatus> {
  const result = await db.query(
    `
      INSERT INTO users_mfa_status (user_id, status, grace_expires_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        grace_expires_at = EXCLUDED.grace_expires_at,
        last_transition_at = CURRENT_TIMESTAMP
      RETURNING *
    `,
    [userId, status, graceExpiresAt]
  );

  return mapMfaStatusRow(result.rows[0] as UserMfaStatusRow);
}
