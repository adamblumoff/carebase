import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Appointment, Collaborator, Recipient, User } from '@carebase/shared';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';

const queriesMock = {
  deleteAppointment: vi.fn(),
  findCollaboratorForRecipient: vi.fn(),
  getAppointmentById: vi.fn(),
  getAppointmentByIdForRecipient: vi.fn(),
  markGoogleSyncPending: vi.fn(),
  resolveRecipientContextForUser: vi.fn(),
  updateAppointment: vi.fn(),
  updateAppointmentForRecipient: vi.fn()
};

vi.mock('../../db/queries.js', () => queriesMock);

const {
  updateAppointmentAsOwner,
  updateAppointmentAsCollaborator,
  fetchAppointmentForUser
} = await import('../appointmentService.js');

function createUser(overrides: Partial<User> = {}): User {
  const now = new Date();
  return {
    id: 1,
    email: 'owner@example.com',
    googleId: 'owner-google',
    forwardingAddress: 'owner-forward@example.com',
    planSecret: 'owner-secret',
    planVersion: 1,
    planUpdatedAt: now,
    createdAt: now,
    ...overrides
  };
}

function createRecipient(overrides: Partial<Recipient> = {}): Recipient {
  return {
    id: 50,
    userId: 1,
    displayName: 'Alex Patient',
    createdAt: new Date(),
    ...overrides
  };
}

function createAppointment(overrides: Partial<Appointment> = {}): Appointment {
  const start = new Date();
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    id: 99,
    itemId: 200,
    startLocal: start,
    endLocal: end,
    startTimeZone: 'UTC',
    endTimeZone: 'UTC',
    startOffset: '+00:00',
    endOffset: '+00:00',
    location: 'Clinic',
    prepNote: null,
    summary: 'Checkup',
    icsToken: 'ics-token',
    createdAt: new Date(),
    assignedCollaboratorId: null,
    googleSync: null,
    ...overrides
  };
}

function resetQueryMocks() {
  Object.values(queriesMock).forEach((fn) => fn.mockReset());
}

beforeEach(() => {
  resetQueryMocks();
});

describe('updateAppointmentAsOwner', () => {
  it('preserves collaborator when no change requested', async () => {
    const user = createUser();
    const recipient = createRecipient({ userId: user.id });
    const appointment = createAppointment({ assignedCollaboratorId: 77 });

    queriesMock.getAppointmentById.mockResolvedValueOnce(appointment);
    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({ recipient, collaborator: null });
    queriesMock.updateAppointment.mockImplementationOnce(async (_id, _user, updates) =>
      createAppointment({ ...appointment, ...updates })
    );

    const updated = await updateAppointmentAsOwner(user, appointment.id, { summary: 'Updated summary' });
    expect(updated.summary).toBe('Updated summary');
    expect(queriesMock.findCollaboratorForRecipient).not.toHaveBeenCalled();
    expect(queriesMock.markGoogleSyncPending).toHaveBeenCalledWith(appointment.itemId);
    const [, , updatePayload] = queriesMock.updateAppointment.mock.calls[0] as [number, number, any];
    expect(updatePayload.assignedCollaboratorId).toBe(77);
  });

  it('clears collaborator assignment when empty string provided', async () => {
    const user = createUser();
    const recipient = createRecipient({ userId: user.id });
    const appointment = createAppointment({ assignedCollaboratorId: 55 });

    queriesMock.getAppointmentById.mockResolvedValueOnce(appointment);
    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({ recipient, collaborator: null });
    queriesMock.updateAppointment.mockImplementationOnce(async (_id, _user, updates) =>
      createAppointment({ ...appointment, ...updates })
    );

    const updated = await updateAppointmentAsOwner(user, appointment.id, { assignedCollaboratorId: '' });
    expect(updated.assignedCollaboratorId).toBeNull();
  });

  it('throws NotFoundError when collaborator does not exist', async () => {
    const user = createUser();
    const recipient = createRecipient({ userId: user.id });
    const appointment = createAppointment();

    queriesMock.getAppointmentById.mockResolvedValueOnce(appointment);
    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({ recipient, collaborator: null });
    queriesMock.findCollaboratorForRecipient.mockResolvedValueOnce(null);

    await expect(
      updateAppointmentAsOwner(user, appointment.id, { assignedCollaboratorId: 123 })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('updateAppointmentAsCollaborator', () => {
  it('rejects when user is not collaborator', async () => {
    const user = createUser();
    const recipient = createRecipient({ userId: user.id });

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({ recipient, collaborator: null });

    await expect(updateAppointmentAsCollaborator(user, 1, 'note')).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('updates prep note and queues sync for collaborators', async () => {
    const collaboratorUser = createUser({ id: 500, email: 'collab@example.com' });
    const recipient = createRecipient({ userId: 42 });
    const collaborator: Collaborator = {
      id: 700,
      recipientId: recipient.id,
      userId: collaboratorUser.id,
      email: collaboratorUser.email,
      role: 'contributor',
      status: 'accepted',
      inviteToken: 'token',
      invitedBy: 42,
      invitedAt: new Date(),
      acceptedAt: new Date()
    };
    const appointment = createAppointment({ prepNote: 'old note' });

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({ recipient, collaborator });
    queriesMock.getAppointmentByIdForRecipient.mockResolvedValueOnce(appointment);
    queriesMock.updateAppointmentForRecipient.mockResolvedValueOnce(
      createAppointment({ ...appointment, prepNote: 'Bring forms' })
    );

    const updated = await updateAppointmentAsCollaborator(collaboratorUser, appointment.id, 'Bring forms');
    expect(updated.prepNote).toBe('Bring forms');
    expect(queriesMock.markGoogleSyncPending).toHaveBeenCalledWith(appointment.itemId);
  });
});

describe('fetchAppointmentForUser', () => {
  it('throws when appointment is missing', async () => {
    const user = createUser();
    const recipient = createRecipient({ userId: user.id });

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({ recipient, collaborator: null });
    queriesMock.getAppointmentById.mockResolvedValueOnce(null);

    await expect(fetchAppointmentForUser(user, 200)).rejects.toBeInstanceOf(NotFoundError);
  });
});
