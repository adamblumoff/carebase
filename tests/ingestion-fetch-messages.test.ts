jest.mock('../api/lib/caregiver', () => ({
  ensureCaregiver: jest.fn(async () => 'caregiver-1'),
}));

// Import after mocks to avoid loading ESM-only uuid dependency.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { fetchMessages } = require('../api/modules/ingestion/router');

describe('fetchMessages', () => {
  test('includes labelAdded message ids without falling back to list', async () => {
    const historyList = jest.fn(async () => ({
      data: {
        history: [
          {
            labelsAdded: [{ message: { id: 'msg-1' } }, { message: { id: 'msg-2' } }],
          },
        ],
        historyId: 'hist-2',
      },
    }));

    const messagesList = jest.fn(async () => ({
      data: { messages: [] },
    }));

    const gmail = {
      users: {
        history: { list: historyList },
        messages: { list: messagesList },
      },
    } as any;

    const result = await fetchMessages(gmail, 'user@example.com', 'hist-1');

    expect(result.messageIds).toEqual(['msg-1', 'msg-2']);
    expect(messagesList).not.toHaveBeenCalled();
  });

  test('falls back to list when history token is invalid', async () => {
    const historyList = jest.fn(async () => {
      const err: any = new Error('HistoryId not found');
      err.code = 404;
      throw err;
    });

    const messagesList = jest.fn(async () => ({
      data: {
        messages: [{ id: 'msg-9' }],
        historyId: 'hist-9',
      },
    }));

    const gmail = {
      users: {
        history: { list: historyList },
        messages: { list: messagesList },
      },
    } as any;

    const result = await fetchMessages(gmail, 'user@example.com', 'stale');

    expect(result.messageIds).toEqual(['msg-9']);
    expect(result.nextHistoryId).toBe('hist-9');
  });
});
