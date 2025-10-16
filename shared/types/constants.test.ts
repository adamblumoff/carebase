import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLABORATOR_ROLES,
  COLLABORATOR_STATUSES,
  type CollaboratorPayload,
  type PlanPayload
} from './index.js';

test('collaborator role and status runtime guards remain aligned with type definitions', () => {
  assert.deepEqual(COLLABORATOR_ROLES, ['owner', 'contributor']);
  assert.deepEqual(COLLABORATOR_STATUSES, ['pending', 'accepted']);
});

test('plan payload contract includes collaborator invite token visibility fields', () => {
  const collaborator: CollaboratorPayload = {
    id: 1,
    recipientId: 2,
    email: 'teammate@example.com',
    userId: null,
    role: 'contributor',
    status: 'pending',
    inviteToken: 'token-123',
    invitedBy: 99,
    invitedAt: new Date().toISOString(),
    acceptedAt: null
  };

  const payload: PlanPayload = {
    recipient: { id: 2, displayName: 'Alex Patient' },
    dateRange: {
      start: '2025-10-15T00:00:00.000Z',
      end: '2025-10-22T00:00:00.000Z'
    },
    appointments: [],
    bills: [],
    planVersion: 5,
    planUpdatedAt: '2025-10-15T12:00:00.000Z',
    collaborators: [collaborator]
  };

  assert.equal(payload.collaborators[0].inviteToken, 'token-123');
  assert.equal(typeof payload.planUpdatedAt, 'string');
});
