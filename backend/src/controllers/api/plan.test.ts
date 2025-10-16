import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import type { Collaborator, Recipient, User } from '@carebase/shared';
import { getPlan, getPlanVersionHandler } from './plan.js';

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

test('getPlan returns owner view with pending invite tokens intact', async () => {
  const queries = await import('../../db/queries.js');
  const owner: User = {
    id: 101,
    email: 'owner@example.com',
    googleId: 'owner-google',
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

  const findRecipientsMock = mock.method(queries, 'findRecipientsByUserId', async () => [recipient]);
  const ensureOwnerMock = mock.method(queries, 'ensureOwnerCollaborator', async () => {});
  const getAppointmentsMock = mock.method(queries, 'getUpcomingAppointments', async () => []);
  const getBillsMock = mock.method(queries, 'getUpcomingBills', async () => []);
  const getPlanVersionMock = mock.method(queries, 'getPlanVersion', async () => ({
    planVersion: 5,
    planUpdatedAt: '2025-10-15T12:00:00.000Z'
  }));
  const listCollaboratorsMock = mock.method(queries, 'listCollaborators', async () => collaborators);
  const findCollaboratorRecipientMock = mock.method(queries, 'findRecipientForCollaborator', async () => undefined);

  const req = {
    user: owner,
    query: {}
  } as unknown as Request;
  const { res, getStatus, getJson } = createResponseHarness();

  await getPlan(req, res);

  assert.equal(getStatus(), null, 'should not set an error status code');
  const payload = getJson<{
    collaborators: Collaborator[];
    planVersion: number;
  }>();
  assert.ok(payload, 'should return JSON payload');
  assert.equal(payload.planVersion, 5);
  const pendingCollab = payload.collaborators.find((c) => c.email === 'pending@example.com');
  assert.ok(pendingCollab);
  assert.equal(pendingCollab?.inviteToken, 'pending-token', 'owner should see invite token');
  const acceptedCollab = payload.collaborators.find((c) => c.email === 'accepted@example.com');
  assert.ok(acceptedCollab);
  assert.equal(acceptedCollab?.inviteToken, '', 'accepted collaborators should not expose tokens');

  assert.equal(findRecipientsMock.mock.callCount(), 1);
  assert.equal(ensureOwnerMock.mock.callCount(), 1);
  assert.equal(getAppointmentsMock.mock.callCount(), 1);
  assert.equal(getBillsMock.mock.callCount(), 1);
  assert.equal(getPlanVersionMock.mock.callCount(), 1);
  assert.equal(listCollaboratorsMock.mock.callCount(), 1);
  assert.equal(findCollaboratorRecipientMock.mock.callCount(), 0);

  mock.restoreAll();
});

test('getPlan falls back to collaborator view and strips pending tokens', async () => {
  const queries = await import('../../db/queries.js');
  const collaboratorUser: User = {
    id: 202,
    email: 'collab@example.com',
    googleId: 'collab-google',
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

  const collaborators: Collaborator[] = [
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
  ];

  mock.method(queries, 'findRecipientsByUserId', async () => []);
  mock.method(queries, 'ensureOwnerCollaborator', async () => {});
  mock.method(queries, 'getUpcomingAppointments', async () => []);
  mock.method(queries, 'getUpcomingBills', async () => []);
  mock.method(queries, 'getPlanVersion', async () => ({
    planVersion: 9,
    planUpdatedAt: '2025-10-15T12:00:00.000Z'
  }));
  mock.method(queries, 'listCollaborators', async () => collaborators);
  mock.method(queries, 'findRecipientForCollaborator', async () => recipient);

  const req = {
    user: collaboratorUser,
    query: {}
  } as unknown as Request;
  const { res, getStatus, getJson } = createResponseHarness();

  await getPlan(req, res);

  assert.equal(getStatus(), null);
  const payload = getJson<{
    collaborators: Collaborator[];
  }>();
  assert.ok(payload);
  assert.equal(
    payload.collaborators.every((collab) => collab.inviteToken === ''),
    true,
    'collaborator view should hide invite tokens'
  );
  assert.equal(
    payload.collaborators.length,
    1,
    'collaborator view should only include accepted collaborators'
  );

  mock.restoreAll();
});

test('getPlan returns 404 when user has no recipient context', async () => {
  const queries = await import('../../db/queries.js');
  mock.method(queries, 'findRecipientsByUserId', async () => []);
  mock.method(queries, 'findRecipientForCollaborator', async () => undefined);

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

  assert.equal(getStatus(), 404);
  const payload = getJson<{ error: string }>();
  assert.equal(payload?.error, 'No recipient found');

  mock.restoreAll();
});

test('getPlanVersionHandler returns owner plan version for owner users', async () => {
  const queries = await import('../../db/queries.js');
  const ownerRecipient = {
    id: 55,
    userId: 1,
    displayName: 'Alex Patient',
    createdAt: new Date()
  } satisfies Recipient;

  const findRecipientsMock = mock.method(queries, 'findRecipientsByUserId', async () => [ownerRecipient]);
  const findCollaboratorMock = mock.method(queries, 'findRecipientForCollaborator', async () => undefined);
  const getPlanVersionMock = mock.method(queries, 'getPlanVersion', async () => ({
    planVersion: 12,
    planUpdatedAt: '2025-10-15T15:30:00.000Z'
  }));

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

  assert.equal(getStatus(), null);
  const payload = getJson<{ planVersion: number; planUpdatedAt: string }>();
  assert.deepEqual(payload, {
    planVersion: 12,
    planUpdatedAt: '2025-10-15T15:30:00.000Z'
  });
  assert.equal(getPlanVersionMock.mock.callCount(), 1);
  assert.equal(getPlanVersionMock.mock.calls[0].arguments[0], 1);
  assert.equal(findRecipientsMock.mock.callCount(), 1);
  assert.equal(findCollaboratorMock.mock.callCount(), 0);

  mock.restoreAll();
});

test('getPlanVersionHandler returns owner plan version for collaborators', async () => {
  const queries = await import('../../db/queries.js');
  const findRecipientsMock = mock.method(queries, 'findRecipientsByUserId', async () => []);
  const collaboratorRecipient = {
    id: 77,
    userId: 42,
    displayName: 'Jordan Patient',
    createdAt: new Date()
  } satisfies Recipient;
  const findCollaboratorMock = mock.method(queries, 'findRecipientForCollaborator', async () => collaboratorRecipient);
  const getPlanVersionMock = mock.method(queries, 'getPlanVersion', async () => ({
    planVersion: 7,
    planUpdatedAt: '2025-10-16T11:00:00.000Z'
  }));

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

  assert.equal(getStatus(), null);
  const payload = getJson<{ planVersion: number; planUpdatedAt: string }>();
  assert.deepEqual(payload, {
    planVersion: 7,
    planUpdatedAt: '2025-10-16T11:00:00.000Z'
  });
  assert.equal(getPlanVersionMock.mock.callCount(), 1);
  assert.equal(getPlanVersionMock.mock.calls[0].arguments[0], 42);
  assert.equal(findRecipientsMock.mock.callCount(), 1);
  assert.equal(findCollaboratorMock.mock.callCount(), 1);

  mock.restoreAll();
});
