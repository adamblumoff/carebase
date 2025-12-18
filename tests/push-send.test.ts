import { sendPushToCaregiver } from '../api/lib/push';

describe('sendPushToCaregiver', () => {
  test('chunks messages and fails on non-2xx', async () => {
    const tokens = Array.from({ length: 205 }, (_, idx) => ({
      token: `ExponentPushToken[t${idx}]`,
    }));

    const calls: any[] = [];
    const fetchMock = jest.fn(async (_url: any, init: any) => {
      calls.push(init);
      return {
        ok: false,
        status: 500,
        text: async () => 'boom',
      } as any;
    });
    (global as any).fetch = fetchMock;

    const fakeDb: any = {
      select: () => ({
        from: () => ({
          where: async () => tokens,
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
    };

    const res = await sendPushToCaregiver({
      db: fakeDb,
      caregiverId: 'cg1',
      title: 'Hello',
      body: 'World',
    });

    // 205 tokens => 3 requests (100 + 100 + 5)
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(calls[0].body).length).toBe(100);
    expect(JSON.parse(calls[1].body).length).toBe(100);
    expect(JSON.parse(calls[2].body).length).toBe(5);

    expect(res.ok).toBe(false);
    // Sent counts only successful batches; with non-2xx all batches fail.
    expect(res.sent).toBe(0);
  });
});
