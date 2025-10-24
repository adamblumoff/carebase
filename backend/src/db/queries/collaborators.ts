import type { Collaborator, CollaboratorRole, CollaboratorStatus, Recipient, User } from '@carebase/shared';
import { db } from './shared.js';
import { generateToken } from './shared.js';
import { recipientRowToRecipient } from './recipients.js';

let collaboratorSchemaEnsured = false;
let collaboratorEnsurePromise: Promise<void> | null = null;

async function ensureCollaboratorSchema(): Promise<void> {
  if (collaboratorSchemaEnsured) {
    return;
  }

  if (!collaboratorEnsurePromise) {
    collaboratorEnsurePromise = (async () => {
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS care_collaborators (
            id SERIAL PRIMARY KEY,
            recipient_id INTEGER NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            email VARCHAR(320) NOT NULL,
            role VARCHAR(20) NOT NULL DEFAULT 'contributor' CHECK (role IN ('owner', 'contributor')),
            status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
            invite_token VARCHAR(64) NOT NULL UNIQUE,
            invited_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            accepted_at TIMESTAMP
          )
        `);
        await db.query(
          `ALTER TABLE appointments
             ADD COLUMN IF NOT EXISTS assigned_collaborator_id INTEGER REFERENCES care_collaborators(id) ON DELETE SET NULL`
        );
        await db.query(
          `ALTER TABLE bills
             ADD COLUMN IF NOT EXISTS assigned_collaborator_id INTEGER REFERENCES care_collaborators(id) ON DELETE SET NULL`
        );
        await db.query(
          `CREATE INDEX IF NOT EXISTS idx_collaborators_recipient_id ON care_collaborators(recipient_id)`
        );
        await db.query(
          `CREATE INDEX IF NOT EXISTS idx_collaborators_user_id ON care_collaborators(user_id)`
        );
        await db.query(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_collaborators_recipient_email ON care_collaborators(recipient_id, email)`
        );
      } catch (error) {
        console.error('Failed to ensure collaborator schema:', error);
      } finally {
        collaboratorSchemaEnsured = true;
      }
    })();
  }

  await collaboratorEnsurePromise;
}

interface CollaboratorRow {
  id: number;
  recipient_id: number;
  user_id: number | null;
  email: string;
  role: CollaboratorRole;
  status: CollaboratorStatus;
  invite_token: string;
  invited_by: number;
  invited_at: Date;
  accepted_at: Date | null;
}

function collaboratorRowToCollaborator(row: CollaboratorRow): Collaborator {
  return {
    id: row.id,
    recipientId: row.recipient_id,
    userId: row.user_id,
    email: row.email,
    role: row.role,
    status: row.status,
    inviteToken: row.invite_token,
    invitedBy: row.invited_by,
    invitedAt: row.invited_at,
    acceptedAt: row.accepted_at
  };
}

export async function ensureOwnerCollaborator(recipientId: number, user: User): Promise<Collaborator> {
  await ensureCollaboratorSchema();
  const existing = await db.query(
    `SELECT * FROM care_collaborators WHERE recipient_id = $1 AND user_id = $2 LIMIT 1`,
    [recipientId, user.id]
  );

  if (existing.rows[0]) {
    return collaboratorRowToCollaborator(existing.rows[0] as CollaboratorRow);
  }

  const token = generateToken(16);
  const result = await db.query(
    `INSERT INTO care_collaborators (recipient_id, user_id, email, role, status, invite_token, invited_by, invited_at, accepted_at)
     VALUES ($1, $2, $3, 'owner', 'accepted', $4, $2, NOW(), NOW())
     RETURNING *`,
    [recipientId, user.id, user.email, token]
  );

  return collaboratorRowToCollaborator(result.rows[0] as CollaboratorRow);
}

export async function createCollaboratorInvite(
  recipientId: number,
  invitedByUserId: number,
  email: string,
  role: CollaboratorRole = 'contributor'
): Promise<{ collaborator: Collaborator; created: boolean; resent: boolean }> {
  await ensureCollaboratorSchema();
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.query(
    `SELECT * FROM care_collaborators WHERE recipient_id = $1 AND email = $2 LIMIT 1`,
    [recipientId, normalizedEmail]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0] as CollaboratorRow;
    if (row.status === 'pending') {
      const newToken = generateToken(16);
      const refreshed = await db.query(
        `UPDATE care_collaborators
         SET invite_token = $1,
             invited_at = NOW(),
             invited_by = $2
         WHERE id = $3
         RETURNING *`,
        [newToken, invitedByUserId, row.id]
      );
      return {
        collaborator: collaboratorRowToCollaborator(refreshed.rows[0] as CollaboratorRow),
        created: false,
        resent: true,
      };
    }

    return {
      collaborator: collaboratorRowToCollaborator(row),
      created: false,
      resent: false,
    };
  }

  const token = generateToken(16);
  const result = await db.query(
    `INSERT INTO care_collaborators (recipient_id, email, role, status, invite_token, invited_by)
     VALUES ($1, $2, $3, 'pending', $4, $5)
     RETURNING *`,
    [recipientId, normalizedEmail, role, token, invitedByUserId]
  );

  return {
    collaborator: collaboratorRowToCollaborator(result.rows[0] as CollaboratorRow),
    created: true,
    resent: false,
  };
}

export async function listCollaborators(recipientId: number): Promise<Collaborator[]> {
  await ensureCollaboratorSchema();
  const result = await db.query(
    `SELECT * FROM care_collaborators WHERE recipient_id = $1 ORDER BY role DESC, invited_at ASC`,
    [recipientId]
  );
  return result.rows.map((row) => collaboratorRowToCollaborator(row as CollaboratorRow));
}

export async function acceptCollaboratorInvite(token: string, user: User): Promise<Collaborator | null> {
  await ensureCollaboratorSchema();
  const normalizedToken = token.trim();
  const result = await db.query(
    `UPDATE care_collaborators
     SET status = 'accepted', accepted_at = NOW(), user_id = $2
     WHERE invite_token = $1
     RETURNING *`,
    [normalizedToken, user.id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return collaboratorRowToCollaborator(result.rows[0] as CollaboratorRow);
}

export async function findRecipientForCollaborator(userId: number): Promise<Recipient | undefined> {
  await ensureCollaboratorSchema();
  const result = await db.query(
    `SELECT r.*
     FROM care_collaborators c
     JOIN recipients r ON r.id = c.recipient_id
     WHERE c.user_id = $1 AND c.status = 'accepted'
     ORDER BY c.accepted_at DESC
     LIMIT 1`,
    [userId]
  );

  return result.rows[0] ? recipientRowToRecipient(result.rows[0] as any) : undefined;
}

export async function findCollaboratorById(id: number): Promise<Collaborator | undefined> {
  await ensureCollaboratorSchema();
  const result = await db.query('SELECT * FROM care_collaborators WHERE id = $1', [id]);
  return result.rows[0] ? collaboratorRowToCollaborator(result.rows[0] as CollaboratorRow) : undefined;
}

export async function findCollaboratorForRecipient(
  recipientId: number,
  collaboratorId: number
): Promise<Collaborator | undefined> {
  await ensureCollaboratorSchema();
  const result = await db.query(
    `SELECT * FROM care_collaborators WHERE recipient_id = $1 AND id = $2 LIMIT 1`,
    [recipientId, collaboratorId]
  );
  return result.rows[0] ? collaboratorRowToCollaborator(result.rows[0] as CollaboratorRow) : undefined;
}

export async function resolveRecipientContextForUser(userId: number): Promise<{ recipient: Recipient | null; collaborator: Collaborator | null }> {
  const recipientResult = await db.query(
    `SELECT * FROM recipients WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [userId]
  );
  if (recipientResult.rows[0]) {
    return {
      recipient: recipientRowToRecipient(recipientResult.rows[0] as any),
      collaborator: null
    };
  }

  const collaboratorRecipient = await findRecipientForCollaborator(userId);
  if (!collaboratorRecipient) {
    return { recipient: null, collaborator: null };
  }

  const collaboratorResult = await db.query(
    `SELECT * FROM care_collaborators WHERE recipient_id = $1 AND user_id = $2 LIMIT 1`,
    [collaboratorRecipient.id, userId]
  );

  return {
    recipient: collaboratorRecipient,
    collaborator: collaboratorResult.rows[0]
      ? collaboratorRowToCollaborator(collaboratorResult.rows[0] as CollaboratorRow)
      : null
  };
}

export async function hasCollaboratorInviteForEmail(email: string): Promise<boolean> {
  await ensureCollaboratorSchema();
  const normalizedEmail = email.trim().toLowerCase();
  const result = await db.query(
    `SELECT 1 FROM care_collaborators WHERE email = $1 LIMIT 1`,
    [normalizedEmail]
  );
  return result.rows.length > 0;
}

export async function findCollaboratorByToken(token: string): Promise<Collaborator | undefined> {
  await ensureCollaboratorSchema();
  const result = await db.query(
    `SELECT * FROM care_collaborators WHERE invite_token = $1 LIMIT 1`,
    [token]
  );
  return result.rows[0] ? collaboratorRowToCollaborator(result.rows[0] as CollaboratorRow) : undefined;
}

export async function listAcceptedCollaboratorEmailsForOwner(userId: number): Promise<string[]> {
  try {
    await ensureCollaboratorSchema();
  } catch (error) {
    if (!(error instanceof Error) || !/Not supported/i.test(error.message)) {
      throw error;
    }
  }
  const result = await db.query(
    `SELECT DISTINCT LOWER(c.email) AS email
     FROM care_collaborators c
     JOIN recipients r ON c.recipient_id = r.id
     WHERE r.user_id = $1
       AND c.status = 'accepted'
       AND c.role IN ('owner', 'contributor')
       AND (c.user_id IS NULL OR c.user_id <> $1)`,
    [userId]
  );
  return result.rows
    .map((row) => (row.email as string | null)?.trim())
    .filter((email): email is string => Boolean(email));
}

export { ensureCollaboratorSchema };

export function __resetCollaboratorSchemaForTests(): void {
  collaboratorSchemaEnsured = false;
  collaboratorEnsurePromise = null;
}
