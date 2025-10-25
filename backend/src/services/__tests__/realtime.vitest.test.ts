import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Socket } from 'socket.io';
import { initRealtime, getRealtimeEmitter } from '../realtime.js';

const verifyClerkSessionToken = vi.hoisted(() => vi.fn());
const findUserByClerkUserId = vi.hoisted(() => vi.fn());
const incrementMetric = vi.hoisted(() => vi.fn());
const planPublisherInstance = vi.hoisted(() => ({
  emitPlanItemDelta: vi.fn()
}));

vi.mock('../clerkAuthGateway.js', () => ({
  verifyClerkSessionToken
}));
vi.mock('../../db/queries.js', () => ({
  findUserByClerkUserId
}));
vi.mock('../../utils/metrics.js', () => ({
  incrementMetric
}));
vi.mock('../planRealtimePublisher.js', () => ({
  PlanRealtimePublisher: vi.fn(() => planPublisherInstance)
}));

function createSocket(overrides: Partial<Socket> = {}): Socket {
  return {
    data: {},
    request: {},
    handshake: { auth: {} },
    join: vi.fn(),
    emit: vi.fn(),
    on: vi.fn(),
    leave: vi.fn(),
    ...overrides
  } as Socket;
}

describe('realtime service', () => {
  let ioUse: any;
  let ioHandlers: Record<string, Function>;

  beforeEach(() => {
    vi.clearAllMocks();
    ioHandlers = {};
    ioUse = null;
    planPublisherInstance.emitPlanItemDelta.mockReset();
    const io = {
      use(fn: any) {
        ioUse = fn;
      },
      on(event: string, handler: any) {
        ioHandlers[event] = handler;
      }
    };
    initRealtime(io as any);
  });

  it('rejects sockets without credentials', async () => {
    const socket = createSocket();
    const next = vi.fn();

    await ioUse(socket, next);

    expect(next).toHaveBeenCalledWith(new Error('Unauthorized'));
    expect(verifyClerkSessionToken).not.toHaveBeenCalled();
  });

  it('authenticates clerk session tokens and joins rooms', async () => {
    const socket = createSocket({
      handshake: { auth: { token: 'session-token' } }
    });
    const next = vi.fn();
    verifyClerkSessionToken.mockResolvedValueOnce({
      userId: 'clerk_1',
      sessionId: 'sess_123'
    });
    findUserByClerkUserId.mockResolvedValueOnce({
      id: 42,
      email: 'user@example.com'
    });

    await ioUse(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.user).toEqual({ id: 42, email: 'user@example.com' });
    expect(incrementMetric).toHaveBeenCalledWith('auth.clerk.socket', 1, { via: 'clerk-session' });

    const onConnection = ioHandlers['connection'];
    onConnection?.(socket);

    expect(socket.join).toHaveBeenCalledWith('user:42');
    expect(socket.emit).toHaveBeenCalledWith('connection:ack', { ok: true });

    const disconnectHandler = (socket.on as any).mock.calls.find(
      ([event]: [string]) => event === 'disconnect'
    )?.[1];
    disconnectHandler?.();
    expect(socket.leave).toHaveBeenCalledWith('user:42');
  });

  it('emits plan deltas via realtime emitter', () => {
    const emitter = getRealtimeEmitter();
    emitter?.emitPlanItemDelta(10, { action: 'created', entityId: 5, itemType: 'bill', source: 'rest', version: 1 });
    expect(planPublisherInstance.emitPlanItemDelta).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ action: 'created', entityId: 5 })
    );
  });
});
