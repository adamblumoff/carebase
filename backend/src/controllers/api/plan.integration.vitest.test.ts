import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Request, Response } from 'express';
import type { Collaborator, Recipient, User } from '@carebase/shared';

const queries = await import('../../db/queries.js');
const { getPlan, getPlanVersionHandler } = await import('./plan.js');

function createResponseHarness() {
  let statusCode: number | null = null;
  let jsonPayload: any = null;

  const res: Partial<Response> = {
    status(code: number) {
      statusCode = code;
      return this as Response;
    },
    json(payload: unknown) {
      jsonPayload = payload;
      return this as Response;
    }
  };

  return {
    res: res as Response,
    getStatus: () => statusCode,
    getJson: <T>() => jsonPayload as T
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('plan controller integration with queries', () => {
  it('returns owner view with pending invite tokens intact', async () => {
    const owner: User = {
      id: 101,
      email: 'owner@example.com',
      googleId: 'owner-google',
      legacyGoogleId: 'owner-google',
      clerkUserId: null,
      passwordResetRequired: false,
      forwardingAddress: 'owner-forward@example.com',
      planSecret: 'secret',
      createdAt: new Date(),
      planVersion: 3,
      planUpdatedAt: new Date()
    };

    const recipient: Recipient = {
      id: 55,
      userId: owner.id,
      displayName: 'Alex Patient',
      createdAt: new Date()
    };

    const collaborators: Collaborator[] = [
      {
        id: 200,
        recipientId: recipient.id,
        userId: null,
        email: 'pending@example.com',
        role: 'contributor',
        status: 'pending',
        inviteToken: 'pending-token',
        invitedBy: owner.id,
        invitedAt: new Date(),
        acceptedAt: null
      },
      {
        id: 201,
        recipientId: recipient.id,
        userId: 999,
        email: 'accepted@example.com',
        role: 'contributor',
        status: 'accepted',
        inviteToken: 'accepted-token',
        invitedBy: owner.id,
        invitedAt: new Date(),
        acceptedAt: new Date()
      }
    ];

    const findRecipientsMock = vi
      .spyOn(queries, 'findRecipientsByUserId')
      .mockResolvedValue([recipient]);
    const ensureOwnerMock = vi.spyOn(queries, 'ensureOwnerCollaborator').mockResolvedValue();
    const getAppointmentsMock = vi.spyOn(queries, 'getUpcomingAppointments').mockResolvedValue([]);
    const getBillsMock = vi.spyOn(queries, 'getUpcomingBills').mockResolvedValue([]);
    const getPlanVersionMock = vi.spyOn(queries, 'getPlanVersion').mockResolvedValue({
      planVersion: 5,
      planUpdatedAt: '2025-10-15T12:00:00.000Z'
    });
    const listCollaboratorsMock = vi
      .spyOn(queries, 'listCollaborators')
      .mockResolvedValue(collaborators);
    const findCollaboratorRecipientMock = vi
      .spyOn(queries, 'findRecipientForCollaborator')
      .mockResolvedValue(undefined);

    const req = {
      user: owner,
      query: {}
    } as unknown as Request;
    const { res, getStatus, getJson } = createResponseHarness();

    await getPlan(req, res);

    expect(getStatus()).toBeNull();
    const payload = getJson<{
      collaborators: Collaborator[];
      planVersion: number;
    }>();
    expect(payload).toBeTruthy();
    expect(payload?.planVersion).toBe(5);
    const pendingCollab = payload?.collaborators.find((c) => c.email === 'pending@example.com');
    expect(pendingCollab?.inviteToken).toBe('pending-token');
    const acceptedCollab = payload?.collaborators.find((c) => c.email === 'accepted@example.com');
    expect(acceptedCollab?.inviteToken).toBe('');

    expect(findRecipientsMock).toHaveBeenCalledTimes(1);
    expect(ensureOwnerMock).toHaveBeenCalledTimes(1);
    expect(getAppointmentsMock).toHaveBeenCalledTimes(1);
    expect(getBillsMock).toHaveBeenCalledTimes(1);
    expect(getPlanVersionMock).toHaveBeenCalledTimes(1);
    expect(listCollaboratorsMock).toHaveBeenCalledTimes(1);
    expect(findCollaboratorRecipientMock).not.toHaveBeenCalled();
  });

  it('falls back to collaborator view and strips pending tokens', async () => {
    const collaboratorUser: User = {
      id: 202,
      email: 'collab@example.com',
      googleId: 'collab-google',
      legacyGoogleId: 'collab-google',
      clerkUserId: null,
      passwordResetRequired: false,
      forwardingAddress: 'collab-forward@example.com',
      planSecret: 'secret',
      createdAt: new Date(),
      planVersion: 1,
      planUpdatedAt: new Date()
    };

    const recipient: Recipient = {
      id: 77,
      userId: 42,
      displayName: 'Chris Patient',
      createdAt: new Date()
    };

    vi.spyOn(queries, 'findRecipientsByUserId').mockResolvedValue([]);
    vi.spyOn(queries, 'ensureOwnerCollaborator').mockResolvedValue();
    vi.spyOn(queries, 'getUpcomingAppointments').mockResolvedValue([]);
    vi.spyOn(queries, 'getUpcomingBills').mockResolvedValue([]);
    vi.spyOn(queries, 'getPlanVersion').mockResolvedValue({
      planVersion: 9,
      planUpdatedAt: '2025-10-15T12:00:00.000Z'
    });
    vi.spyOn(queries, 'listCollaborators').mockResolvedValue([
      {
        id: 300,
        recipientId: recipient.id,
        userId: collaboratorUser.id,
        email: collaboratorUser.email,
        role: 'contributor',
        status: 'accepted',
        inviteToken: 'collab-token',
        invitedBy: 42,
        invitedAt: new Date(),
        acceptedAt: new Date()
      },
      {
        id: 301,
        recipientId: recipient.id,
        userId: null,
        email: 'pending@example.com',
        role: 'contributor',
        status: 'pending',
        inviteToken: 'pending-token',
        invitedBy: 42,
        invitedAt: new Date(),
        acceptedAt: null
      }
    ] as Collaborator[]);
    vi.spyOn(queries, 'findRecipientForCollaborator').mockResolvedValue(recipient);

    const req = {
      user: collaboratorUser,
      query: {}
    } as unknown as Request;
    const { res, getStatus, getJson } = createResponseHarness();

    await getPlan(req, res);

    expect(getStatus()).toBeNull();
    const payload = getJson<{ collaborators: Collaborator[] }>();
    expect(payload).toBeTruthy();
    expect(payload?.collaborators.every((collab) => collab.inviteToken === '')).toBe(true);
    expect(payload?.collaborators.length).toBe(1);
  });

  it('returns 404 when user has no recipient context', async () => {
    vi.spyOn(queries, 'findRecipientsByUserId').mockResolvedValue([]);
    vi.spyOn(queries, 'findRecipientForCollaborator').mockResolvedValue(undefined);

    const req = {
      user: {
        id: 404,
        email: 'missing@example.com',
        googleId: 'missing',
        forwardingAddress: 'missing@forward',
        planSecret: 'secret',
        createdAt: new Date(),
        planVersion: 0,
        planUpdatedAt: new Date()
      },
      query: {}
    } as unknown as Request;
    const { res, getStatus, getJson } = createResponseHarness();

    await getPlan(req, res);

    expect(getStatus()).toBe(404);
    const payload = getJson<{ error: string }>();
    expect(payload?.error).toBe('No recipient found');
  });

  it('getPlanVersionHandler returns owner plan version for owner users', async () => {
    const ownerRecipient = {
      id: 55,
      userId: 1,
      displayName: 'Alex Patient',
      createdAt: new Date()
    } satisfies Recipient;

    const findRecipientsMock = vi
      .spyOn(queries, 'findRecipientsByUserId')
      .mockResolvedValue([ownerRecipient]);
    const findCollaboratorMock = vi
      .spyOn(queries, 'findRecipientForCollaborator')
      .mockResolvedValue(undefined);
    const getPlanVersionMock = vi.spyOn(queries, 'getPlanVersion').mockResolvedValue({
      planVersion: 12,
      planUpdatedAt: '2025-10-15T15:30:00.000Z'
    });

    const req = {
      user: {
        id: 1,
        email: 'user@example.com',
        googleId: 'google-1',
        forwardingAddress: 'forward@example.com',
        planSecret: 'secret',
        createdAt: new Date(),
        planVersion: 0,
        planUpdatedAt: new Date()
      }
    } as unknown as Request;
    const { res, getStatus, getJson } = createResponseHarness();

    await getPlanVersionHandler(req, res);

    expect(getStatus()).toBeNull();
    const payload = getJson<{ planVersion: number; planUpdatedAt: string }>();
    expect(payload).toEqual({
      planVersion: 12,
      planUpdatedAt: '2025-10-15T15:30:00.000Z'
    });
    expect(getPlanVersionMock).toHaveBeenCalledTimes(1);
    expect(getPlanVersionMock.mock.calls[0]?.[0]).toBe(1);
    expect(findRecipientsMock).toHaveBeenCalledTimes(1);
    expect(findCollaboratorMock).not.toHaveBeenCalled();
  });

  it('getPlanVersionHandler returns owner plan version for collaborators', async () => {
    vi.spyOn(queries, 'findRecipientsByUserId').mockResolvedValue([]);
    const collaboratorRecipient = {
      id: 77,
      userId: 42,
      displayName: 'Jordan Patient',
      createdAt: new Date()
    } satisfies Recipient;
    const findCollaboratorMock = vi
      .spyOn(queries, 'findRecipientForCollaborator')
      .mockResolvedValue(collaboratorRecipient);
    const getPlanVersionMock = vi.spyOn(queries, 'getPlanVersion').mockResolvedValue({
      planVersion: 7,
      planUpdatedAt: '2025-10-16T11:00:00.000Z'
    });

    const req = {
      user: {
        id: 200,
        email: 'collab@example.com',
        googleId: 'collab-google',
        forwardingAddress: 'collab-forward@example.com',
        planSecret: 'secret',
        createdAt: new Date(),
        planVersion: 0,
        planUpdatedAt: new Date()
      }
    } as unknown as Request;
    const { res, getStatus, getJson } = createResponseHarness();

    await getPlanVersionHandler(req, res);

    expect(getStatus()).toBeNull();
    const payload = getJson<{ planVersion: number; planUpdatedAt: string }>();
    expect(payload).toEqual({
      planVersion: 7,
      planUpdatedAt: '2025-10-16T11:00:00.000Z'
    });
    expect(getPlanVersionMock).toHaveBeenCalledTimes(1);
    expect(getPlanVersionMock.mock.calls[0]?.[0]).toBe(42);
    expect(findCollaboratorMock).toHaveBeenCalledTimes(1);
  });
});
