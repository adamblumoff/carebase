import { TRPCError } from '@trpc/server';

import { ensureNoMembership, requireCareRecipientMembership } from '../api/lib/careRecipient';

jest.mock('../api/lib/caregiver', () => ({
  ensureCaregiver: jest.fn(async () => 'caregiver_1'),
}));

function createCtx({ hasMembership }: { hasMembership: boolean }) {
  const membershipRow = hasMembership
    ? [{ caregiverId: 'caregiver_1', careRecipientId: 'recipient_1', role: 'owner' }]
    : [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => membershipRow,
        }),
      }),
    }),
  };

  return { db } as any;
}

describe('care recipient membership errors', () => {
  test('requireCareRecipientMembership throws PRECONDITION_FAILED when missing', async () => {
    const ctx = createCtx({ hasMembership: false });
    await expect(requireCareRecipientMembership(ctx)).rejects.toMatchObject<TRPCError>({
      code: 'PRECONDITION_FAILED',
      message: 'Care recipient not set up',
    });
  });

  test('ensureNoMembership throws PRECONDITION_FAILED when already set', async () => {
    const ctx = createCtx({ hasMembership: true });
    await expect(ensureNoMembership(ctx)).rejects.toMatchObject<TRPCError>({
      code: 'PRECONDITION_FAILED',
      message: 'Care recipient already set',
    });
  });
});
