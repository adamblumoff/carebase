import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { Bill, Recipient, User } from '@carebase/shared';
import { ForbiddenError, NotFoundError } from '../../utils/errors.js';

const queriesMock = {
  deleteBill: vi.fn(),
  findCollaboratorForRecipient: vi.fn(),
  getBillById: vi.fn(),
  getBillByIdForRecipient: vi.fn(),
  markGoogleSyncPending: vi.fn(),
  resolveRecipientContextForUser: vi.fn(),
  updateBill: vi.fn(),
  updateBillForRecipient: vi.fn(),
  updateBillStatus: vi.fn(),
  updateBillStatusForRecipient: vi.fn()
};

vi.mock('../../db/queries.js', () => queriesMock);

vi.mock('../../utils/dateFormatting.js', () => ({
  formatDateOnly: (value: Date | string) => {
    if (value instanceof Date) {
      return value.toISOString().split('T')[0];
    }
    return String(value);
  }
}));

const {
  updateBillAsOwner,
  updateBillAsCollaborator,
  deleteBillAsOwner
} = await import('../billService.js');

function createUser(overrides: Partial<User> = {}): User {
  const now = new Date();
  return {
    id: 1,
    email: 'owner@example.com',
    googleId: 'owner-google',
    legacyGoogleId: 'owner-google',
    clerkUserId: null,
    passwordResetRequired: false,
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
    id: 20,
    userId: 1,
    displayName: 'Jamie Patient',
    createdAt: new Date(),
    ...overrides
  };
}

function createBill(overrides: Partial<Bill> = {}): Bill {
  const now = new Date();
  return {
    id: 10,
    itemId: 80,
    statementDate: now,
    amount: 120.5,
    dueDate: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    payUrl: 'https://pay.example.com',
    status: 'todo',
    taskKey: 'task-1',
    createdAt: now,
    assignedCollaboratorId: null,
    googleSync: null,
    ...overrides
  };
}

function resetQueryMocks(): void {
  Object.values(queriesMock).forEach((fn) => fn.mockReset());
}

beforeEach(() => {
  resetQueryMocks();
});

describe('updateBillAsOwner', () => {
  it('keeps existing collaborator when none supplied', async () => {
    const user = createUser();
    const recipient = createRecipient({ userId: user.id });
    const bill = createBill({ assignedCollaboratorId: 400 });

    queriesMock.getBillById.mockResolvedValueOnce(bill);
    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({ recipient, collaborator: null });
    queriesMock.updateBill.mockImplementationOnce(async (_id, _userId, updates: Record<string, unknown>) =>
      createBill({ ...bill, ...updates })
    );

    const updated = await updateBillAsOwner(user, bill.id, { amount: '', dueDate: '', statementDate: '' });
    expect(updated.assignedCollaboratorId).toBe(400);
    expect(queriesMock.findCollaboratorForRecipient).not.toHaveBeenCalled();
    expect(queriesMock.markGoogleSyncPending).toHaveBeenCalledWith(bill.itemId);
  });

  it('validates collaborator existence', async () => {
    const user = createUser();
    const recipient = createRecipient({ userId: user.id });
    const bill = createBill();

    queriesMock.getBillById.mockResolvedValueOnce(bill);
    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({ recipient, collaborator: null });
    queriesMock.findCollaboratorForRecipient.mockResolvedValueOnce(null);

    await expect(
      updateBillAsOwner(user, bill.id, { assignedCollaboratorId: 999 })
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('updateBillAsCollaborator', () => {
  it('throws when user is not collaborator', async () => {
    const user = createUser();
    const recipient = createRecipient({ userId: user.id });

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({ recipient, collaborator: null });

    await expect(updateBillAsCollaborator(user, 10, 'paid')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('deleteBillAsOwner', () => {
  it('queues sync prior to deletion', async () => {
    const user = createUser();
    const recipient = createRecipient({ userId: user.id });
    const bill = createBill();

    queriesMock.resolveRecipientContextForUser.mockResolvedValueOnce({ recipient, collaborator: null });
    queriesMock.getBillById.mockResolvedValueOnce(bill);

    await deleteBillAsOwner(user, bill.id);

    expect(queriesMock.markGoogleSyncPending).toHaveBeenCalledWith(bill.itemId);
    expect(queriesMock.deleteBill).toHaveBeenCalledWith(bill.id, user.id);
  });
});
