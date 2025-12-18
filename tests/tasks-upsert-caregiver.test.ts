import { TRPCError } from '@trpc/server';

import { appRouter } from '../api/trpc/root';

jest.mock('../api/lib/caregiver', () => ({
  ensureCaregiver: jest.fn(async () => 'caregiver-1'),
}));

type DbConfig = {
  selectResponses: any[];
  updateResponse?: any[];
  insertResponse?: any[];
};

const createDb = ({ selectResponses, updateResponse, insertResponse }: DbConfig) => {
  const selectQueue = [...selectResponses];

  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => selectQueue.shift() ?? [],
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async () => updateResponse ?? [],
        }),
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: async () => insertResponse ?? [],
        }),
      }),
    }),
  };
};

const baseCtx = (db: any) => ({
  db,
  auth: { userId: 'user-1' },
  req: { log: { error: jest.fn(), warn: jest.fn() } },
});

describe('tasks.upsertCaregiver authorization', () => {
  test('rejects non-owner caregivers', async () => {
    const db = createDb({
      selectResponses: [[{ caregiverId: 'caregiver-1', careRecipientId: 'hub-1', role: 'viewer' }]],
    });

    const caller = appRouter.createCaller(baseCtx(db) as any);

    await expect(
      caller.tasks.upsertCaregiver({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'viewer@example.com',
        name: 'Viewer',
      })
    ).rejects.toMatchObject<TRPCError>({ code: 'FORBIDDEN' });
  });

  test('rejects updates for caregivers outside the hub', async () => {
    const db = createDb({
      selectResponses: [
        [{ caregiverId: 'caregiver-1', careRecipientId: 'hub-1', role: 'owner' }],
        [],
      ],
    });

    const caller = appRouter.createCaller(baseCtx(db) as any);

    await expect(
      caller.tasks.upsertCaregiver({
        id: '22222222-2222-2222-2222-222222222222',
        email: 'outsider@example.com',
        name: 'Outsider',
      })
    ).rejects.toMatchObject<TRPCError>({ code: 'FORBIDDEN' });
  });

  test('allows owner to update caregiver in the hub', async () => {
    const db = createDb({
      selectResponses: [
        [{ caregiverId: 'caregiver-1', careRecipientId: 'hub-1', role: 'owner' }],
        [
          {
            caregiverId: '33333333-3333-3333-3333-333333333333',
            careRecipientId: 'hub-1',
            role: 'viewer',
          },
        ],
      ],
      updateResponse: [
        { id: '33333333-3333-3333-3333-333333333333', email: 'member@example.com', name: 'Member' },
      ],
    });

    const caller = appRouter.createCaller(baseCtx(db) as any);

    const result = await caller.tasks.upsertCaregiver({
      id: '33333333-3333-3333-3333-333333333333',
      email: 'member@example.com',
      name: 'Member',
    });

    expect(result).toMatchObject({
      email: 'member@example.com',
      name: 'Member',
    });
  });
});
