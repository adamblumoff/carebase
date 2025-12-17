import { TRPCError } from '@trpc/server';

import { isInviteToken, validateInvitationStillUsable } from '../api/lib/careRecipient';

jest.mock('../api/lib/caregiver', () => ({
  ensureCaregiver: jest.fn(async () => 'caregiver_1'),
}));

describe('care recipient invites', () => {
  test('validateInvitationStillUsable rejects used invites', async () => {
    await expect(
      validateInvitationStillUsable({ usedAt: new Date(), expiresAt: null })
    ).rejects.toMatchObject<TRPCError>({
      code: 'BAD_REQUEST',
      message: 'Invite already used',
    });
  });

  test('validateInvitationStillUsable rejects expired invites', async () => {
    await expect(
      validateInvitationStillUsable({
        usedAt: null,
        expiresAt: new Date(Date.now() - 60_000),
      })
    ).rejects.toMatchObject<TRPCError>({
      code: 'BAD_REQUEST',
      message: 'Invite expired',
    });
  });

  test('isInviteToken has sane bounds', () => {
    expect(isInviteToken('short')).toBe(false);
    expect(isInviteToken('123456789012')).toBe(true);
    expect(isInviteToken('x'.repeat(64))).toBe(true);
    expect(isInviteToken('x'.repeat(65))).toBe(false);
  });
});
