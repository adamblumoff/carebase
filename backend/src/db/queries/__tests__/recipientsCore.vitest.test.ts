import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sharedModule from '../shared.js';
import * as recipients from '../recipients.js';

let querySpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  querySpy = vi.spyOn(sharedModule.db, 'query').mockImplementation(async () => ({ rows: [], rowCount: 0 }));
});

afterEach(() => {
  querySpy.mockRestore();
});

describe('recipient queries', () => {
  it('creates a recipient with the provided display name', async () => {
    const row = {
      id: 5,
      user_id: 3,
      display_name: 'Primary',
      created_at: new Date('2030-09-01T00:00:00Z')
    };
    querySpy.mockImplementationOnce(async () => ({ rows: [row], rowCount: 1 }));

    const created = await recipients.createRecipient(3, 'Primary');

    expect(created).toEqual({
      id: 5,
      userId: 3,
      displayName: 'Primary',
      createdAt: row.created_at
    });
  });

  it('finds recipients by user and id and returns undefined when missing', async () => {
    const row = {
      id: 7,
      user_id: 4,
      display_name: 'Care Recipient',
      created_at: new Date('2030-09-15T00:00:00Z')
    };
    querySpy
      .mockImplementationOnce(async () => ({ rows: [row], rowCount: 1 })) // list by user
      .mockImplementationOnce(async () => ({ rows: [row], rowCount: 1 })) // find by id
      .mockImplementationOnce(async () => ({ rows: [], rowCount: 0 })); // missing id

    const list = await recipients.findRecipientsByUserId(4);
    expect(list).toHaveLength(1);

    const found = await recipients.findRecipientById(7);
    expect(found?.displayName).toBe('Care Recipient');

    const missing = await recipients.findRecipientById(999);
    expect(missing).toBeUndefined();
  });
});
