import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { User } from '@carebase/shared';
import { findUserByClerkUserId } from '../db/queries.js';
import { verifyClerkSessionToken } from './clerkSyncService.js';
import { incrementMetric } from '../utils/metrics.js';

const userRoom = (userId: number) => `user:${userId}`;

export interface RealtimeEmitter {
  emitPlanUpdate(userId: number): void;
}

let emitter: RealtimeEmitter | null = null;

async function authenticateSocket(socket: Socket): Promise<User | null> {
  const req = socket.request as any;

  if (req.user && req.user.id) {
    return req.user as User;
  }

  const authHeader: string | undefined = req.headers?.authorization;
  let bearerToken: string | undefined;
  if (authHeader?.startsWith('Bearer ')) {
    bearerToken = authHeader.slice(7).trim();
  }

  const token = socket.handshake.auth?.token || bearerToken;
  if (!token) {
    return null;
  }

  const clerkVerification = await verifyClerkSessionToken(token);
  if (clerkVerification) {
    const user = await findUserByClerkUserId(clerkVerification.userId);
    if (user) {
      console.log('[Realtime] Authenticated via Clerk session', {
        userId: user.id,
        clerkUserId: clerkVerification.userId,
        sessionId: clerkVerification.sessionId
      });
      incrementMetric('auth.clerk.socket', 1, { via: 'clerk-session' });
      return user;
    }
  }

  return null;
}

export function initRealtime(io: SocketIOServer): void {
  io.use(async (socket, next) => {
    try {
      const user = await authenticateSocket(socket);
      if (!user) {
        return next(new Error('Unauthorized'));
      }
      (socket.data as { user: User }).user = user;
      return next();
    } catch (error) {
      return next(error instanceof Error ? error : new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user: User = socket.data.user;
    socket.join(userRoom(user.id));
    socket.emit('connection:ack', { ok: true });

    socket.on('disconnect', () => {
      socket.leave(userRoom(user.id));
    });
  });

  emitter = {
    emitPlanUpdate(userId: number) {
      io.to(userRoom(userId)).emit('plan:update');
    }
  };
}

export function getRealtimeEmitter(): RealtimeEmitter | null {
  return emitter;
}

export function __setRealtimeEmitterForTests(testEmitter: RealtimeEmitter | null): void {
  emitter = testEmitter;
}
