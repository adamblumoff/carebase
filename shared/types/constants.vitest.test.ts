import { describe, it, expect } from 'vitest';
import {
  COLLABORATOR_ROLES,
  COLLABORATOR_STATUSES,
  type CollaboratorPayload,
  type PlanPayload
} from './index.js';

describe('shared constants', () => {
  it('aligns collaborator role and status runtime guards with type definitions', () => {
    expect(COLLABORATOR_ROLES).toEqual(['owner', 'contributor']);
    expect(COLLABORATOR_STATUSES).toEqual(['pending', 'accepted']);
  });

  it('maintains plan payload contract collaborator invite token visibility', () => {
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

    expect(payload.collaborators[0]!.inviteToken).toBe('token-123');
    expect(typeof payload.planUpdatedAt).toBe('string');
  });
});
