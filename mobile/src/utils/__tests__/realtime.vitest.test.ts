import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ensureRealtimeConnected, isRealtimeConnected, addRealtimeStatusListener } from '../realtime';
import { fetchClerkSessionToken } from '../../auth/clerkTokenCache';

vi.mock('../../auth/clerkTokenCache', () => ({
  fetchClerkSessionToken: vi.fn()
}));

const mockEmitPlanChanged = vi.fn();

vi.mock('../planEvents', () => ({
  emitPlanChanged: (...args: any[]) => mockEmitPlanChanged(...args)
}));

const socketHandlers: Record<string, (...args: any[]) => void> = {};

const connectSpy = vi.fn();

vi.mock('socket.io-client', () => ({
  io: (...args: any[]) => {
    connectSpy(...args);
    return {
      on: (event: string, handler: (...args: any[]) => void) => {
        socketHandlers[event] = handler;
      }
    };
  }
}));

const mockedTokenFetcher = fetchClerkSessionToken as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(socketHandlers)) {
    delete socketHandlers[key];
  }
  mockedTokenFetcher.mockResolvedValue('token-123');
});

describe('realtime', () => {
  it('initializes socket once and tracks connection status', async () => {
    const statuses: string[] = [];
    addRealtimeStatusListener((status) => {
      statuses.push(status);
    });

    await ensureRealtimeConnected();

    expect(connectSpy).toHaveBeenCalledTimes(1);
    socketHandlers['connect']?.();
    expect(isRealtimeConnected()).toBe(true);
    socketHandlers['plan:update']?.();
    expect(mockEmitPlanChanged).toHaveBeenCalled();

    socketHandlers['disconnect']?.('io server disconnect');
    expect(isRealtimeConnected()).toBe(false);
    expect(statuses).toEqual(['connected', 'disconnected']);
  });
});
